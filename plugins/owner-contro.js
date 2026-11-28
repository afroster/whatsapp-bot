/*
@Ragnar 24/26
*/

const { Module, plugins } = require('../lib/plugins');

Module({
    command: 'enable',
    aliases: ['enablecmd'],
    package: 'owner',
    description: 'Enable a command',
    owner: true
})(async (message, match) => {
    const command = match.trim().toLowerCase();
    if (!command) {
        return message.send('Usage: .enable command');}
    const target = plugins.find(command);
    if (!target) return message.send(`cmd "${command}" not found`);
    if (!plugins.enable(command))  return message.send('Unable to enable command');
    
    return message.send(
        `*COMMAND ENABLED*\n\n` +
        `Name: ${target.command}\n` +
        `Aliases: ${target.aliases.join(', ')}`
    );
});


Module({
    command: 'disable',
    aliases: ['disablecmd'],
    package: 'owner',
    description: 'Disable a command',
    owner: true
})(async (message, match) => {
    const command = match.trim().toLowerCase();
    if (!command) return message.send('.disable command');
    const target = plugins.find(command);
    if (!target) { return message.send(`Cmd "${command}" not found`);}
    if (!plugins.disable(command)) {
        return message.send('Unable to disable command');
    }

    return message.send(
        `*COMMAND DISABLED*\n\n` +
        `Name: ${target.command}\n` +
        `Aliases: ${target.aliases.join(', ')}`
    );
});
                    
  
