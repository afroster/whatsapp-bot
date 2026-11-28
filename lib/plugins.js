const fs = require('fs');
const path = require('path');

class Plugins {
  constructor(options = {}) {
    this.commands = [];
    this.events = [];
    this.plugins = [];
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
      throw new TypeError('Plugin metadata must be an object');
    }

    if (typeof exec !== 'function') {
      throw new TypeError('Plugin execution must be a function');
    }

    if (data.on) {
      if (typeof data.on !== 'string') {
        throw new TypeError('Plugin event must be a string');
      }
    } else if (
      typeof data.command !== 'string' ||
      !data.command.trim()
    ) {
      throw new TypeError('Plugin command is required');
    }

    if (
      data.aliases !== undefined &&
      !Array.isArray(data.aliases) &&
      typeof data.aliases !== 'string'
    ) {
      throw new TypeError('Plugin aliases must be an array or string');
    }

    if (
      data.cooldown !== undefined &&
      (!Number.isFinite(Number(data.cooldown)) ||
        Number(data.cooldown) < 0)
    ) {
      throw new TypeError('Cooldown must be a non-negative number');
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
        throw new Error(`Duplicate command: ${name}`);
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

    this.plugins.push(plugin);

    return exec;
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

  checkCooldown(plugin, message) {
    const seconds = plugin.cooldown || 0;

    if (!seconds) {
      return { allowed: true, remaining: 0 };
    }

    const sender = message.sender || message.from;

    if (!sender) {
      throw new Error('Message sender is required for cooldown');
    }

    const key = JSON.stringify([plugin.command, sender]);
    const now = Date.now();
    const expires = this.cooldowns.get(key);

    if (expires && expires > now) {
      return {
        allowed: false,
        remaining: Math.ceil((expires - now) / 1000)
      };
    }

    this.cooldowns.delete(key);

    return { allowed: true, remaining: 0 };
  }

  async execute(command, message, match) {
    const plugin = typeof command === 'string'
      ? this.findEnabled(command)
      : command;

    if (!plugin || !plugin.enabled) return false;

    const cooldown = this.checkCooldown(plugin, message);

    if (!cooldown.allowed) {
      await message.send(
        `Please wait ${cooldown.remaining}s before using this command again.`
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

  resetCooldown(command, sender) {
    const plugin = this.find(command);

    if (!plugin) return false;

    if (sender) {
      return this.cooldowns.delete(
        JSON.stringify([plugin.command, sender])
      );
    }

    for (const key of this.cooldowns.keys()) {
      const [name] = JSON.parse(key);

      if (name === plugin.command) {
        this.cooldowns.delete(key);
      }
    }

    return true;
  }

  clearCooldowns() {
    this.cooldowns.clear();
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

  remove(command) {
    const plugin = this.find(command);

    if (!plugin) return false;

    this.plugins.splice(this.plugins.indexOf(plugin), 1);
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

  clear() {
    this.commands.length = 0;
    this.events.length = 0;
    this.plugins.length = 0;
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
      const filePath = path.resolve(dir, file);

      try {
        require(filePath);

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

    const files = fs.readdirSync(dir)
      .filter(file => file.endsWith('.js'));

    for (const file of files) {
      const filePath = require.resolve(path.resolve(dir, file));
      delete require.cache[filePath];
    }

    this.clear();

    return this.load_plugins(dir);
  }

  stats() {
    return {
      total: this.plugins.length,
      commands: this.commands.length,
      events: this.events.length,
      aliases: this.commands.reduce(
        (total, plugin) => total + plugin.aliases.length,
        0
      ),
      enabled: this.plugins.filter(plugin => plugin.enabled).length,
      disabled: this.plugins.filter(plugin => !plugin.enabled).length,
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
  checkCooldown: plugins.checkCooldown.bind(plugins),
  resetCooldown: plugins.resetCooldown.bind(plugins),
  clearCooldowns: plugins.clearCooldowns.bind(plugins),
  getCommands: plugins.getCommands.bind(plugins),
  getEvents: plugins.getEvents.bind(plugins),
  getByPackage: plugins.getByPackage.bind(plugins),
  getAliases: plugins.getAliases.bind(plugins),
  remove: plugins.remove.bind(plugins),
  enable: plugins.enable.bind(plugins),
  disable: plugins.disable.bind(plugins),
  stats: plugins.stats.bind(plugins),
  commands: plugins.commands,
  events: plugins.events
};
