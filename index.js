const fs = require('fs');
const path = require('path');

module.exports = function PacketLogger(mod) {
    let enabled = false;
    let logFile = null;
    let logStream = null;
    let packetCount = { sent: 0, received: 0 };
    let config = null;
    let opcodeMap = {};
    let blacklist = [];
    let packetDescriptions = {};
    let packetDefinitions = {};
    
    // Load packet definitions
    function loadPacketDefinitions() {
        try {
            const definitionsDir = path.join(__dirname, '../../data/definitions');
            if (fs.existsSync(definitionsDir)) {
                const files = fs.readdirSync(definitionsDir);
                for (const file of files) {
                    if (file.endsWith('.def')) {
                        const packetName = file.replace(/\.\d+\.def$/, '');
                        const version = parseInt(file.match(/\.(\d+)\.def$/)?.[1] || '1');
                        
                        if (!packetDefinitions[packetName]) {
                            packetDefinitions[packetName] = {};
                        }
                        
                        const content = fs.readFileSync(path.join(definitionsDir, file), 'utf8');
                        packetDefinitions[packetName][version] = parseDefinitionFile(content);
                    }
                }
                mod.log(`Loaded ${Object.keys(packetDefinitions).length} packet definition types`);
            }
        } catch (error) {
            mod.log(`Error loading packet definitions: ${error.message}`);
        }
    }
    
    // Parse a .def file into a structured format
    function parseDefinitionFile(content) {
        const lines = content.split('\n');
        const fields = [];
        let offset = 0;
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            const parts = trimmed.split(/\s+/);
            if (parts.length < 2) continue;
            
            const type = parts[0];
            const name = parts[1];
            
            if (type === 'array') {
                // Handle array fields
                fields.push({
                    name: name,
                    type: 'array',
                    offset: offset,
                    size: 4 // array length is typically 4 bytes
                });
                offset += 4;
            } else if (type === 'string') {
                // Handle string fields
                fields.push({
                    name: name,
                    type: 'string',
                    offset: offset,
                    size: 0 // variable size
                });
                offset += 4; // string length
            } else {
                // Handle primitive types
                const size = getTypeSize(type);
                fields.push({
                    name: name,
                    type: type,
                    offset: offset,
                    size: size
                });
                offset += size;
            }
        }
        
        return fields;
    }
    
    // Get the size of a data type
    function getTypeSize(type) {
        const sizes = {
            'int8': 1, 'uint8': 1, 'byte': 1,
            'int16': 2, 'uint16': 2,
            'int32': 4, 'uint32': 4,
            'int64': 8, 'uint64': 8,
            'float': 4, 'double': 8,
            'bool': 1,
            'vec3': 12, // 3 floats
            'angle': 4, // float
            'ref': 4
        };
        return sizes[type] || 4; // default to 4 bytes
    }
    
    // Parse packet data using actual packet definitions
    function parsePacketData(opcode, data) {
        try {
            const opcodeName = translateOpcode(opcode);
            const description = packetDescriptions[opcodeName];
            
            if (!description) {
                return null; // No custom description for this packet
            }
            
            // Find the packet definition
            const definitions = packetDefinitions[opcodeName];
            if (!definitions) {
                return null; // No definition found
            }
            
            // Use the latest version (highest number)
            const versions = Object.keys(definitions).map(v => parseInt(v)).sort((a, b) => b - a);
            if (versions.length === 0) {
                return null;
            }
            
            const latestVersion = versions[0];
            const fields = definitions[latestVersion];
            
            // Parse the packet data
            const parsedData = {};
            let currentOffset = 0;
            
            for (const field of fields) {
                if (currentOffset >= data.length) break;
                
                try {
                    const value = readFieldValue(data, currentOffset, field);
                    if (value !== undefined) {
                        parsedData[field.name] = value;
                    }
                    currentOffset += field.size;
                } catch (error) {
                    // Skip this field if we can't read it
                    currentOffset += field.size;
                }
            }
            
            // Format location if present
            if (parsedData.loc && typeof parsedData.loc === 'object') {
                parsedData.loc = `(${parsedData.loc.x?.toFixed(2) || 0}, ${parsedData.loc.y?.toFixed(2) || 0}, ${parsedData.loc.z?.toFixed(2) || 0})`;
            }
            
            return {
                description: description.description,
                fields: parsedData,
                format: description.format
            };
        } catch (error) {
            return null;
        }
    }
    
    // Read a field value from the packet data
    function readFieldValue(data, offset, field) {
        if (offset >= data.length) return undefined;
        
        switch (field.type) {
            case 'int8':
                return data.readInt8(offset);
            case 'uint8':
                return data.readUInt8(offset);
            case 'int16':
                return data.readInt16LE(offset);
            case 'uint16':
                return data.readUInt16LE(offset);
            case 'int32':
                return data.readInt32LE(offset);
            case 'uint32':
                return data.readUInt32LE(offset);
            case 'int64':
                return data.readBigInt64LE(offset);
            case 'uint64':
                return data.readBigUInt64LE(offset);
            case 'float':
                return data.readFloatLE(offset);
            case 'double':
                return data.readDoubleLE(offset);
            case 'bool':
                return data.readUInt8(offset) !== 0;
            case 'vec3':
                if (offset + 12 <= data.length) {
                    return {
                        x: data.readFloatLE(offset),
                        y: data.readFloatLE(offset + 4),
                        z: data.readFloatLE(offset + 8)
                    };
                }
                return undefined;
            case 'angle':
                return data.readFloatLE(offset);
            case 'string':
                // Read string length first
                const length = data.readUInt32LE(offset);
                if (offset + 4 + length <= data.length) {
                    return data.toString('utf8', offset + 4, offset + 4 + length);
                }
                return undefined;
            case 'array':
                // Read array length
                const arrayLength = data.readUInt32LE(offset);
                return arrayLength; // For now, just return the length
            default:
                return undefined;
        }
    }
    
    // Format packet data using custom descriptions
    function formatPacketData(parsedData) {
        if (!parsedData) return null;
        
        try {
            let formatted = parsedData.format;
            for (const [key, value] of Object.entries(parsedData.fields)) {
                const placeholder = `{${key}}`;
                if (formatted.includes(placeholder)) {
                    formatted = formatted.replace(placeholder, String(value));
                }
            }
            return formatted;
        } catch (error) {
            return null;
        }
    }
    
    // Load packet descriptions
    function loadPacketDescriptions() {
        try {
            const descriptionsPath = path.join(__dirname, 'packet-descriptions.json');
            if (fs.existsSync(descriptionsPath)) {
                const descriptionsData = JSON.parse(fs.readFileSync(descriptionsPath, 'utf8'));
                packetDescriptions = descriptionsData.packets || {};
                mod.log(`Loaded ${Object.keys(packetDescriptions).length} packet descriptions`);
            } else {
                mod.log('No packet descriptions file found, creating default one');
                const defaultDescriptions = {
                    "description": "Custom packet field descriptions for readable output",
                    "packets": {
                        "S_SPAWN_NPC": {
                            "description": "NPC spawned",
                            "fields": ["gameId", "loc", "aggressive"],
                            "format": "NPC {gameId} at {loc} (aggressive: {aggressive})"
                        },
                        "S_SPAWN_USER": {
                            "description": "Player spawned",
                            "fields": ["gameId", "name", "loc", "level"],
                            "format": "Player {name} (ID: {gameId}) at {loc} (Level: {level})"
                        },
                        "S_CHAT": {
                            "description": "Chat message",
                            "fields": ["name", "message", "channel"],
                            "format": "[{channel}] {name}: {message}"
                        }
                    }
                };
                fs.writeFileSync(descriptionsPath, JSON.stringify(defaultDescriptions, null, 2));
                packetDescriptions = defaultDescriptions.packets;
            }
        } catch (error) {
            mod.log(`Error loading packet descriptions: ${error.message}`);
            packetDescriptions = {};
        }
    }
    
    // Load blacklist
    function loadBlacklist() {
        try {
            const blacklistPath = path.join(__dirname, 'blacklist.json');
            if (fs.existsSync(blacklistPath)) {
                const blacklistData = JSON.parse(fs.readFileSync(blacklistPath, 'utf8'));
                blacklist = blacklistData.packets || [];
                mod.log(`Loaded ${blacklist.length} blacklisted packets`);
            } else {
                mod.log('No blacklist file found, creating default one');
                const defaultBlacklist = {
                    "description": "Packets to ignore by default - high frequency, low value packets",
                    "packets": [
                        "S_RESPONSE_GAMESTAT_PONG",
                        "S_SOCIAL",
                        "C_PLAYER_LOCATION",
                        "S_NPC_LOCATION",
                        "S_USER_LOCATION",
                        "S_CREATURE_ROTATE",
                        "C_REQUEST_GAMESTAT_PING",
                        "S_ABNORMALITY_BEGIN",
                        "S_ABNORMALITY_REFRESH",
                        "S_ABNORMALITY_END",
                        "S_ACTION_STAGE",
                        "S_ACTION_END",
                        "S_SPAWN_NPC",
                        "S_DESPAWN_NPC",
                        "S_SPAWN_USER",
                        "S_DESPAWN_USER"
                    ]
                };
                fs.writeFileSync(blacklistPath, JSON.stringify(defaultBlacklist, null, 2));
                blacklist = defaultBlacklist.packets;
            }
        } catch (error) {
            mod.log(`Error loading blacklist: ${error.message}`);
            blacklist = [];
        }
    }
    
    // Check if packet is blacklisted
    function isBlacklisted(opcode) {
        const opcodeName = translateOpcode(opcode);
        return blacklist.includes(opcodeName) || blacklist.includes(opcode.toString());
    }
    
    // Load opcode mapping
    function loadOpcodeMap() {
        try {
            // Try to get the current protocol version from the mod
            const protocolVersion = mod.dispatch?.majorPatchVersion || 376012;
            const opcodeFile = path.join(__dirname, '../../data/opcodes', `protocol.${protocolVersion}.map`);
            
            if (fs.existsSync(opcodeFile)) {
                const content = fs.readFileSync(opcodeFile, 'utf8');
                const lines = content.split('\n');
                
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 2) {
                        const opcodeName = parts[0];
                        const opcodeNumber = parseInt(parts[1]);
                        if (!isNaN(opcodeNumber)) {
                            opcodeMap[opcodeNumber] = opcodeName;
                        }
                    }
                }
                
                mod.log(`Loaded ${Object.keys(opcodeMap).length} opcode mappings from protocol.${protocolVersion}.map`);
            } else {
                mod.log(`Opcode file not found: ${opcodeFile}`);
            }
        } catch (error) {
            mod.log(`Error loading opcode map: ${error.message}`);
        }
    }
    
    // Translate opcode number to name
    function translateOpcode(opcodeNumber) {
        return opcodeMap[opcodeNumber] || `UNKNOWN_${opcodeNumber}`;
    }
    
    // Load configuration
    function loadConfig() {
        const configPath = path.join(__dirname, 'config.json');
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } else {
            config = {
                enabled: false,
                autoStart: false,
                logToFile: true,
                logToConsole: false,
                maxFileSize: 10485760,
                showOpcodeNames: true,
                useBlacklist: true,
                usePacketDescriptions: true,
                filters: {
                    includeOpcode: [],
                    excludeOpcode: [],
                    minPacketSize: 0,
                    maxPacketSize: 0
                },
                output: {
                    includeTimestamp: true,
                    includeDirection: true,
                    includeOpcode: true,
                    includeSize: true,
                    includeHexData: true,
                    includeParsedData: false
                }
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        }
    }
    
    // Save configuration
    function saveConfig() {
        const configPath = path.join(__dirname, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
    
    // Create logs directory if it doesn't exist
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
    }
    
    // Check if packet should be filtered
    function shouldLogPacket(opcode, data) {
        if (!config.filters) return true;
        
        const size = data.length;
        
        // Check blacklist first
        if (config.useBlacklist && isBlacklisted(opcode)) {
            return false;
        }
        
        // Check size filters
        if (config.filters.minPacketSize > 0 && size < config.filters.minPacketSize) return false;
        if (config.filters.maxPacketSize > 0 && size > config.filters.maxPacketSize) return false;
        
        // Check opcode filters (support both names and numbers)
        const opcodeName = translateOpcode(opcode);
        if (config.filters.includeOpcode.length > 0) {
            const hasMatch = config.filters.includeOpcode.some(filter => 
                filter === opcode.toString() || filter === opcodeName
            );
            if (!hasMatch) return false;
        }
        
        if (config.filters.excludeOpcode.some(filter => 
            filter === opcode.toString() || filter === opcodeName
        )) return false;
        
        return true;
    }
    
    // Initialize logging
    function startLogging() {
        if (logStream) {
            logStream.end();
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        logFile = path.join(logsDir, `packet-log-${timestamp}.log`);
        logStream = fs.createWriteStream(logFile, { flags: 'a' });
        
        logStream.write(`=== Packet Log Started: ${new Date().toISOString()} ===\n`);
        logStream.write(`Format: [Timestamp] [Direction] [Opcode] [Size] [Data] [Parsed Info]\n`);
        if (config.useBlacklist) {
            logStream.write(`Blacklist enabled: ${blacklist.length} packets ignored\n`);
        }
        if (config.usePacketDescriptions) {
            logStream.write(`Packet descriptions enabled: ${Object.keys(packetDescriptions).length} packets configured\n`);
        }
        logStream.write('\n');
        
        if (config.logToConsole) {
            mod.log(`Packet logging started. Log file: ${logFile}`);
        }
    }
    
    function stopLogging() {
        if (logStream) {
            logStream.write(`\n=== Packet Log Ended: ${new Date().toISOString()} ===\n`);
            logStream.write(`Total packets - Sent: ${packetCount.sent}, Received: ${packetCount.received}\n`);
            logStream.end();
            logStream = null;
        }
        if (config.logToConsole) {
            mod.log('Packet logging stopped.');
        }
    }
    
    function logPacket(direction, opcode, data) {
        if (!enabled || !shouldLogPacket(opcode, data)) return;
        
        const timestamp = config.output.includeTimestamp ? new Date().toISOString() : '';
        const size = config.output.includeSize ? data.length : 0;
        const hexData = config.output.includeHexData ? data.toString('hex') : '';
        
        // Format opcode display
        let opcodeDisplay = opcode.toString();
        if (config.showOpcodeNames) {
            const opcodeName = translateOpcode(opcode);
            opcodeDisplay = `${opcodeName} (${opcode})`;
        }
        
        // Parse packet data if descriptions are enabled
        let parsedInfo = '';
        if (config.usePacketDescriptions) {
            const parsedData = parsePacketData(opcode, data);
            if (parsedData) {
                const formatted = formatPacketData(parsedData);
                if (formatted) {
                    parsedInfo = ` | ${formatted}`;
                }
            }
        }
        
        let logEntry = '';
        if (config.output.includeTimestamp) logEntry += `[${timestamp}] `;
        if (config.output.includeDirection) logEntry += `[${direction}] `;
        if (config.output.includeOpcode) logEntry += `[${opcodeDisplay}] `;
        if (config.output.includeSize) logEntry += `[${size} bytes] `;
        if (config.output.includeHexData) logEntry += `[${hexData}]`;
        if (parsedInfo) logEntry += parsedInfo;
        
        logEntry += '\n';
        
        if (config.logToFile && logStream) {
            logStream.write(logEntry);
        }
        
        if (config.logToConsole) {
            mod.log(logEntry.trim());
        }
        
        if (direction === 'SENT') {
            packetCount.sent++;
        } else {
            packetCount.received++;
        }
    }
    
    // Hook all packets using raw hooks
    function installPacketHooks() {
        // Hook all client->server packets
        mod.hook('*', 'raw', { order: -Infinity }, (code, data, fromServer, fake) => {
            if (!fake) {
                logPacket('SENT', code, data);
            }
        });
        
        // Hook all server->client packets  
        mod.hook('*', 'raw', { order: Infinity }, (code, data, fromServer, fake) => {
            if (!fake && fromServer) {
                logPacket('RECEIVED', code, data);
            }
        });
    }
    
    // Commands
    mod.command.add('packetlogger', (cmd, ...args) => {
        switch (cmd) {
            case 'start':
                enabled = true;
                config.enabled = true;
                startLogging();
                installPacketHooks();
                saveConfig();
                mod.command.message('Packet logging <font color="#00FF00">started</font>');
                break;
                
            case 'stop':
                enabled = false;
                config.enabled = false;
                stopLogging();
                saveConfig();
                mod.command.message('Packet logging <font color="#FF0000">stopped</font>');
                break;
                
            case 'status':
                const status = enabled ? '<font color="#00FF00">enabled</font>' : '<font color="#FF0000">disabled</font>';
                const fileInfo = logFile ? `\nLog file: ${logFile}` : '';
                const countInfo = `\nPackets logged - Sent: ${packetCount.sent}, Received: ${packetCount.received}`;
                const opcodeInfo = `\nOpcode mappings loaded: ${Object.keys(opcodeMap).length}`;
                const blacklistInfo = config.useBlacklist ? `\nBlacklist enabled: ${blacklist.length} packets ignored` : '\nBlacklist disabled';
                const descriptionsInfo = config.usePacketDescriptions ? `\nPacket descriptions: ${Object.keys(packetDescriptions).length} configured` : '\nPacket descriptions disabled';
                const definitionsInfo = `\nPacket definitions: ${Object.keys(packetDefinitions).length} loaded`;
                mod.command.message(`Packet logger is ${status}${fileInfo}${countInfo}${opcodeInfo}${blacklistInfo}${descriptionsInfo}${definitionsInfo}`);
                break;
                
            case 'clear':
                packetCount = { sent: 0, received: 0 };
                mod.command.message('Packet counters cleared');
                break;
                
            case 'config':
                if (args.length >= 2) {
                    const [setting, value] = args;
                    if (config[setting] !== undefined) {
                        config[setting] = value === 'true' ? true : value === 'false' ? false : value;
                        saveConfig();
                        mod.command.message(`Config updated: ${setting} = ${value}`);
                    } else {
                        mod.command.message(`Unknown setting: ${setting}`);
                    }
                } else {
                    mod.command.message('Usage: /packetlogger config <setting> <value>');
                }
                break;
                
            case 'filter':
                if (args.length >= 2) {
                    const [filterType, ...filterValues] = args;
                    if (config.filters[filterType] !== undefined) {
                        config.filters[filterType] = filterValues;
                        saveConfig();
                        mod.command.message(`Filter updated: ${filterType} = ${filterValues.join(', ')}`);
                    } else {
                        mod.command.message(`Unknown filter: ${filterType}`);
                    }
                } else {
                    mod.command.message('Usage: /packetlogger filter <type> <values...>');
                    mod.command.message('Filter types: includeOpcode, excludeOpcode, minPacketSize, maxPacketSize');
                }
                break;
                
            case 'blacklist':
                if (args.length >= 1) {
                    const subcmd = args[0];
                    switch (subcmd) {
                        case 'list':
                            if (blacklist.length > 0) {
                                mod.command.message(`Blacklisted packets (${blacklist.length}):\n${blacklist.join('\n')}`);
                            } else {
                                mod.command.message('No packets in blacklist');
                            }
                            break;
                            
                        case 'add':
                            if (args.length >= 2) {
                                const packetToAdd = args[1];
                                if (!blacklist.includes(packetToAdd)) {
                                    blacklist.push(packetToAdd);
                                    saveBlacklist();
                                    mod.command.message(`Added ${packetToAdd} to blacklist`);
                                } else {
                                    mod.command.message(`${packetToAdd} is already blacklisted`);
                                }
                            } else {
                                mod.command.message('Usage: /packetlogger blacklist add <packet_name>');
                            }
                            break;
                            
                        case 'remove':
                            if (args.length >= 2) {
                                const packetToRemove = args[1];
                                const index = blacklist.indexOf(packetToRemove);
                                if (index > -1) {
                                    blacklist.splice(index, 1);
                                    saveBlacklist();
                                    mod.command.message(`Removed ${packetToRemove} from blacklist`);
                                } else {
                                    mod.command.message(`${packetToRemove} is not in blacklist`);
                                }
                            } else {
                                mod.command.message('Usage: /packetlogger blacklist remove <packet_name>');
                            }
                            break;
                            
                        case 'toggle':
                            config.useBlacklist = !config.useBlacklist;
                            saveConfig();
                            mod.command.message(`Blacklist ${config.useBlacklist ? 'enabled' : 'disabled'}`);
                            break;
                            
                        default:
                            mod.command.message('Usage: /packetlogger blacklist <list|add|remove|toggle> [packet_name]');
                            break;
                    }
                } else {
                    mod.command.message('Usage: /packetlogger blacklist <list|add|remove|toggle> [packet_name]');
                }
                break;
                
            case 'descriptions':
                if (args.length >= 1) {
                    const subcmd = args[0];
                    switch (subcmd) {
                        case 'list':
                            if (Object.keys(packetDescriptions).length > 0) {
                                const descList = Object.entries(packetDescriptions).map(([name, desc]) => 
                                    `${name}: ${desc.description}`
                                );
                                mod.command.message(`Packet descriptions (${descList.length}):\n${descList.join('\n')}`);
                            } else {
                                mod.command.message('No packet descriptions configured');
                            }
                            break;
                            
                        case 'toggle':
                            config.usePacketDescriptions = !config.usePacketDescriptions;
                            saveConfig();
                            mod.command.message(`Packet descriptions ${config.usePacketDescriptions ? 'enabled' : 'disabled'}`);
                            break;
                            
                        default:
                            mod.command.message('Usage: /packetlogger descriptions <list|toggle>');
                            break;
                    }
                } else {
                    mod.command.message('Usage: /packetlogger descriptions <list|toggle>');
                }
                break;
                
            case 'lookup':
                if (args.length >= 1) {
                    const searchTerm = args[0];
                    const results = [];
                    
                    // Search by opcode number
                    if (!isNaN(searchTerm)) {
                        const opcodeNum = parseInt(searchTerm);
                        const name = opcodeMap[opcodeNum];
                        if (name) {
                            results.push(`${opcodeNum} -> ${name}`);
                        }
                    }
                    
                    // Search by opcode name
                    for (const [num, name] of Object.entries(opcodeMap)) {
                        if (name.toLowerCase().includes(searchTerm.toLowerCase())) {
                            results.push(`${name} -> ${num}`);
                        }
                    }
                    
                    if (results.length > 0) {
                        mod.command.message(`Opcode lookup results for "${searchTerm}":\n${results.slice(0, 10).join('\n')}${results.length > 10 ? '\n... and ' + (results.length - 10) + ' more' : ''}`);
                    } else {
                        mod.command.message(`No opcode found matching "${searchTerm}"`);
                    }
                } else {
                    mod.command.message('Usage: /packetlogger lookup <opcode_number_or_name>');
                }
                break;
                
            default:
                mod.command.message('Available commands: start, stop, status, clear, config, filter, blacklist, descriptions, lookup');
                break;
        }
    });
    
    // Save blacklist to file
    function saveBlacklist() {
        try {
            const blacklistPath = path.join(__dirname, 'blacklist.json');
            const blacklistData = {
                "description": "Packets to ignore by default - high frequency, low value packets",
                "packets": blacklist
            };
            fs.writeFileSync(blacklistPath, JSON.stringify(blacklistData, null, 2));
        } catch (error) {
            mod.log(`Error saving blacklist: ${error.message}`);
        }
    }
    
    // Initialize
    loadConfig();
    loadOpcodeMap();
    loadBlacklist();
    loadPacketDescriptions();
    loadPacketDefinitions();
    enabled = config.enabled;
    
    if (config.autoStart && enabled) {
        startLogging();
        installPacketHooks();
    }
    
    // Cleanup on module unload
    mod.destructor = () => {
        stopLogging();
    };
    
    mod.log('Packet Logger module loaded. Use /packetlogger start to begin logging all packets.');
};
