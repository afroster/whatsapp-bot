/*
@ragnar bot 24/26
*/

const fs = require('fs');
const path = require('path');

class Plugins {
  constructor(options = {}) {
    this.commands = [];
    this.events = [];
    this.errors = [];
    this.cooldowns = new Map();

    this.options = {
      logging: true,
      ...options
    };
  }

  Module(data = {}) {
    return exec => this.register(data, exec);
  }

  validate(data, exec) {
    if (!data || typeof data !== 'object') {
      throw new TypeError('Invalid plugin metadata');
    }

    if (typeof exec !== 'function') {
      throw new TypeError('Plugin execution must be a function');
    }

    if (data.on) {
      if (typeof data.on !== 'string') {
        throw new TypeError('Invalid event name');
      }
    } else if (
      typeof data.command !== 'string' ||
      !data.command.trim()
    ) {
      throw new TypeError('Command name is required');
    }

    if (
      data.aliases !== undefined &&
      !Array.isArray(data.aliases) &&
      typeof data.aliases !== 'string'
    ) {
      throw new TypeError('Aliases must be an array or string');
    }

    if (
      data.cooldown !== undefined &&
      (!Number.isFinite(Number(data.cooldown)) ||
        Number(data.cooldown) < 0)
    ) {
      throw new TypeError('Invalid cooldown');
    }

    return true;
  }

  register(data, exec) {
    this.validate(data, exec);

    const command = data.command?.trim().toLowerCase();

    const aliases = [
      ...new Set(
        (Array.isArray(data.aliases)
          ? data.aliases
          : data.aliases
            ? [data.aliases]
            : []
        )
          .filter(alias => typeof alias === 'string')
          .map(alias => alias.trim().toLowerCase())
          .filter(Boolean)
      )
    ];

    if (command && aliases.includes(command)) {
      throw new Error(`Command cannot alias itself: ${command}`);
    }

    for (const name of [command, ...aliases].filter(Boolean)) {
      if (this.find(name)) {
        throw new Error(`Duplicate command or alias: ${name}`);
      }
    }

    const plugin = {
      ...data,
      command,
      aliases,
      on: data.on?.trim().toLowerCase(),
      cooldown: Number(data.cooldown || 0),
      enabled: data.enabled !== false,
      exec
    };

    if (plugin.on) {
      this.events.push(plugin);
    } else {
      this.commands.push(plugin);
    }

    return plugin;
  }

  find(command) {
    if (typeof command !== 'string') return undefined;

    const name = command.trim().toLowerCase();

    return this.commands.find(plugin =>
      plugin.command === name ||
      plugin.aliases.includes(name)
    );
  }

  findEnabled(command) {
    const plugin = this.find(command);

    return plugin?.enabled ? plugin : undefined;
  }

  getCommands() {
    return this.commands;
  }

  getEvents(event) {
    if (!event) return this.events;

    return this.events.filter(
      plugin => plugin.on === event.toLowerCase()
    );
  }

  getByPackage(packageName) {
    return this.commands.filter(
      plugin => plugin.package?.toLowerCase() === packageName.toLowerCase()
    );
  }

  getAliases() {
    return Object.fromEntries(
      this.commands.flatMap(plugin =>
        plugin.aliases.map(alias => [alias, plugin.command])
      )
    );
  }

  isOwner(message) {
    if (message.fromMe) return true;

    const sender = (message.sender || '').split('@')[0].split(':')[0];

    const sudo = (process.env.SUDO || '')
      .split(',')
      .map(number => number.replace(/\D/g, ''))
      .filter(Boolean);

    const number = sender.replace(/\D/g, '');

    return !!number && sudo.includes(number);
  }

  async checkPermission(plugin, message) {
    const isGroup = message.from?.endsWith('@g.us');

    if (plugin.owner && !this.isOwner(message)) {
      await message.send('This command is restricted to the owner');
      return false;
    }

    if (plugin.group && !isGroup) {
      await message.send('This command can only be used in groups');
      return false;
    }

    if (plugin.private && isGroup) {
      await message.send('This command can only be used in private chat');
      return false;
    }

    if (plugin.admin && (!isGroup || !message.isAdmin)) {
      await message.send('This command is restricted to group admins.');
      return false;
    }

    return true;
  }

  checkCooldown(plugin, message) {
    if (!plugin.cooldown) {
      return { allowed: true, remaining: 0 };
    }

    const sender = message.sender || message.from;

    if (!sender) {
      return { allowed: false, remaining: 0 };
    }

    const key = JSON.stringify([plugin.command, sender]);
    const expires = this.cooldowns.get(key);
    const now = Date.now();

    if (expires && expires > now) {
      return {
        allowed: false,
        remaining: Math.ceil((expires - now) / 1000)
      };
    }

    this.cooldowns.delete(key);

    return { allowed: true, remaining: 0 };
  }

  async execute(plugin, message, match) {
    if (!plugin || !plugin.enabled) return false;

    if (!await this.checkPermission(plugin, message)) {
      return false;
    }

    const cooldown = this.checkCooldown(plugin, message);

    if (!cooldown.allowed) {
      await message.send(
        `Please wait ${cooldown.remaining}s before using this command again`
      );

      return false;
    }

    if (plugin.cooldown > 0) {
      const sender = message.sender || message.from;
      const key = JSON.stringify([plugin.command, sender]);

      this.cooldowns.set(
        key,
        Date.now() + plugin.cooldown * 1000
      );
    }

    return plugin.exec(message, match);
  }

  async handleMessage(message, prefix = '.') {
    const body = message.body || '';

    if (!body.startsWith(prefix)) {
      return false;
    }

    const input = body.slice(prefix.length).trim();

    if (!input) return false;

    const [name, ...args] = input.split(/\s+/);
    const plugin = this.find(name);

    if (!plugin) return false;

    await this.execute(plugin, message, args.join(' '));

    return true;
  }

  async dispatchEvents(message, event = 'text') {
    const plugins = this.getEvents(event);

    for (const plugin of plugins) {
      if (!plugin.enabled) continue;

      try {
        await plugin.exec(message);
      } catch (error) {
        this.errors.push({
          plugin: plugin.on,
          error
        });

        console.error(
          `\x1b[31m[EVENT ERROR]\x1b[0m ${error.message}`
        );
      }
    }
  }

  remove(command) {
    const plugin = this.find(command);

    if (!plugin) return false;

    this.commands.splice(this.commands.indexOf(plugin), 1);

    this.resetCooldown(plugin.command);

    return true;
  }

  enable(command) {
    const plugin = this.find(command);

    if (!plugin) return false;

    plugin.enabled = true;
    return true;
  }

  disable(command) {
    const plugin = this.find(command);

    if (!plugin) return false;

    plugin.enabled = false;
    return true;
  }

  resetCooldown(command, sender) {
    const plugin = this.find(command);

    if (!plugin) return false;

    for (const key of this.cooldowns.keys()) {
      const [name, user] = JSON.parse(key);

      if (
        name === plugin.command &&
        (!sender || sender === user)
      ) {
        this.cooldowns.delete(key);
      }
    }

    return true;
  }

  clearCooldowns() {
    this.cooldowns.clear();
  }

  clear() {
    this.commands.length = 0;
    this.events.length = 0;
    this.errors.length = 0;
    this.clearCooldowns();
  }

  load_plugins(dir = path.join(__dirname, '..', 'plugins')) {
    if (!fs.existsSync(dir)) {
      throw new Error(`Plugin directory not found: ${dir}`);
    }

    const files = fs.readdirSync(dir)
      .filter(file => file.endsWith('.js'))
      .sort();

    for (const file of files) {
      try {
        require(path.resolve(dir, file));

        if (this.options.logging) {
          console.log(`\x1b[32m[PLUGIN]\x1b[0m ${file}`);
        }
      } catch (error) {
        this.errors.push({ file, error });

        console.error(
          `\x1b[31m[PLUGIN ERROR]\x1b[0m ${file}: ${error.message}`
        );
      }
    }

    return this.commands;
  }

  reload_plugins(dir = path.join(__dirname, '..', 'plugins')) {
    if (!fs.existsSync(dir)) {
      throw new Error(`Plugin directory not found: ${dir}`);
    }

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.js')) continue;

      const filePath = require.resolve(path.resolve(dir, file));
      delete require.cache[filePath];
    }

    this.clear();

    return this.load_plugins(dir);
  }

  stats() {
    return {
      commands: this.commands.length,
      events: this.events.length,
      aliases: this.commands.reduce(
        (total, plugin) => total + plugin.aliases.length,
        0
      ),
      enabled: [...this.commands, ...this.events]
        .filter(plugin => plugin.enabled).length,
      disabled: [...this.commands, ...this.events]
        .filter(plugin => !plugin.enabled).length,
      activeCooldowns: this.cooldowns.size,
      errors: this.errors.length
    };
  }
}

const plugins = new Plugins();

module.exports = {
  Plugins,
  plugins,
  Module: plugins.Module.bind(plugins),
  load_plugins: plugins.load_plugins.bind(plugins),
  reload_plugins: plugins.reload_plugins.bind(plugins),
  find: plugins.find.bind(plugins),
  findEnabled: plugins.findEnabled.bind(plugins),
  execute: plugins.execute.bind(plugins),
  handleMessage: plugins.handleMessage.bind(plugins),
  dispatchEvents: plugins.dispatchEvents.bind(plugins),
  getCommands: plugins.getCommands.bind(plugins),
  getEvents: plugins.getEvents.bind(plugins),
  getByPackage: plugins.getByPackage.bind(plugins),
  getAliases: plugins.getAliases.bind(plugins),
  remove: plugins.remove.bind(plugins),
  enable: plugins.enable.bind(plugins),
  disable: plugins.disable.bind(plugins),
  resetCooldown: plugins.resetCooldown.bind(plugins),
  clearCooldowns: plugins.clearCooldowns.bind(plugins),
  stats: plugins.stats.bind(plugins),
  commands: plugins.commands,
  events: plugins.events
};
       
