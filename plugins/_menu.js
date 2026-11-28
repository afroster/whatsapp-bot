const os = require('os');
const { Module, commands, plugins } = require('../lib/plugins');
const config = require('../config');
const TextStyles = require('../lib/textfonts');

const styles = new TextStyles();
const startedAt = Date.now();

Module({
    command: 'menu',
    package: 'general',
    aliases: ['h', 'help'],
    description: 'Show commands, packages and bot information',
    cooldown: '5'
})(async (message, match) => {

    const Func = {};

    Func.uptime = () => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        return `${days}d ${hours}h ${minutes}m ${secs}s`;
    };

    Func.stats = () => {
        const all = [...plugins.commands, ...plugins.events];
        const memory = process.memoryUsage();
        const cpus = os.cpus();
        const load = os.loadavg()[0];

        return {
            ram: (memory.heapUsed / 1024 / 1024).toFixed(2),
            cpu: cpus.length
                ? Math.min(100, (load / cpus.length) * 100).toFixed(1)
                : '0.0',
            commands: plugins.commands.length,
            enabled: all.filter(plugin => plugin.enabled).length,
            disabled: all.filter(plugin => !plugin.enabled).length
        };
    };

    Func.getPackages = list => {
        return list.reduce((groups, plugin) => {
            const name = plugin.package || 'general';

            if (!groups[name]) groups[name] = [];
            groups[name].push(plugin.command);

            return groups;
        }, {});
    };

    Func.packageMenu = (name, list) => {
        const unique = [...new Set(list)].sort((a, b) =>
            a.localeCompare(b)
        );

        let menu = `╭───╼「 *${styles.toMonospace(name.toUpperCase())}* 」\n`;

        for (const command of unique) {
            menu += `┃ ${styles.toMonospace(command)}\n`;
        }

        menu += '╰──────────╼';

        return menu;
    };

    Func.search = (query, list, packages) => {
        const results = list.filter(plugin =>
            plugin.command.includes(query) ||
            plugin.aliases.some(alias => alias.includes(query))
        );

        if (!results.length) {
            return `*NOT FOUND*\n\nNo command or package matching "${query}"\n\n*Available Packages:*\n${packages.map(name => `┃ ${name}`).join('\n')}`;
        }

        let menu = `╭───╼「 *SEARCH* 」\n`;

        for (const plugin of results) {
            menu += `┃ ${styles.toMonospace(plugin.command)}\n`;
            menu += `┃ ${plugin.description || 'No description'}\n\n`;
        }

        menu += '╰──────────╼';

        return menu;
    };

    const owner = plugins.isOwner(message);
    const query = match?.trim().toLowerCase();

    const available = commands.filter(plugin =>
        plugin.command &&
        (owner || !plugin.owner) &&
        (owner || plugin.enabled)
    );

    const grouped = Func.getPackages(available);
    const packages = Object.keys(grouped).sort();

    if (query) {
        const packageName = packages.find(
            name => name.toLowerCase() === query
        );

        if (packageName) {
            return message.send(
                Func.packageMenu(packageName, grouped[packageName])
            );
        }

        const found = available.find(plugin =>
            plugin.command === query ||
            plugin.aliases.includes(query)
        );

        if (found) {
            return message.send(
                `╭───╼「 *COMMAND INFO* 」\n` +
                `┃ Name: ${found.command}\n` +
                `┃ Aliases: ${found.aliases.join(', ') || 'None'}\n` +
                `┃ Package: ${found.package || 'general'}\n` +
                `┃ Description: ${found.description || 'No description'}\n` +
                `┃ Status: ${found.enabled ? 'Enabled' : 'Disabled'}\n` +
                `╰──────────╼`
            );
        }

        return message.send(
            Func.search(query, available, packages)
        );
    }

    const stats = Func.stats();
    const mode = config.WORK_TYPE || process.env.WORK_TYPE;
    const version = require('../package.json').version;

    const time = new Date().toLocaleTimeString('en-ZA', {
        timeZone: 'Africa/Johannesburg'
    });

    let menu = `╭───╼「 *RAGNAR-BOT* 」\n`;
    menu += `┃ ⛥ User: ${styles.toMonospace(message.pushName || 'unknown')}\n`;
    menu += `┃ ⛥ Prefix: ${styles.toMonospace(config.prefix || '.')}\n`;
    menu += `┃ ⛥ Mode: ${styles.toMonospace(mode)}\n`;
    menu += `┃ ⛥ Time: ${styles.toMonospace(time)}\n`;
    menu += `┃ ⛥ Uptime: ${styles.toMonospace(Func.uptime())}\n`;
    menu += `┃ ⛥ Version: ${styles.toMonospace(version)}\n`;
    menu += `╰──────────────╼\n\n`;

    menu += `╭───╼「 *SYSTEM INFO* 」\n`;
    menu += `┃ ⛥ Host: ${styles.toMonospace(os.hostname())}\n`;
    menu += `┃ ⛥ RAM: ${styles.toMonospace(`${stats.ram} MB`)}\n`;
    menu += `┃ ⛥ CPU: ${styles.toMonospace(`${stats.cpu}%`)}\n`;
    menu += `┃ ⛥ Commands: ${styles.toMonospace(stats.commands)}\n`;
    menu += `┃ ⛥ Enabled: ${styles.toMonospace(stats.enabled)}\n`;
    menu += `┃ ⛥ Disabled: ${styles.toMonospace(stats.disabled)}\n`;
    menu += `┃ ⛥ Packages: ${styles.toMonospace(packages.length)}\n`;
    menu += `╰──────────────╼\n\n`;

    for (const pack of packages) {
        menu += Func.packageMenu(pack, grouped[pack]) + '\n\n';
    }

    menu += `*${styles.toMonospace('Ragnar')}*\n`;
    menu += `_Made with ❤️_`;

    return message.send(menu.trim());
});
          
