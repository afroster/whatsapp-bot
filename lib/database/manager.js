const { Sequelize, DataTypes, Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const config = require('../../config');

class Database {
    constructor(options = {}) {
        this.options = options;
        this.models = Object.create(null);
        this.connected = false;
        this.loaded = false;
        this.initializing = null;

        const storage = path.resolve(
            options.storage || config.DATABASE || './database/database.db'
        );

        fs.mkdirSync(path.dirname(storage), { recursive: true });

        this.sequelize = new Sequelize({
            dialect: 'sqlite',
            storage,
            logging: options.logging || false,
            retry: {
                max: 3
            },
            pool: {
                max: 1,
                min: 0,
                idle: 10000
            }
        });
    }

    async connect() {
        if (this.connected) return this;

        await this.sequelize.authenticate();
        this.connected = true;

        return this;
    }

    async loadModels() {
        if (this.loaded) return this.models;
        const directory = path.join(__dirname, 'models');
        fs.mkdirSync(directory, { recursive: true });

        const files = fs.readdirSync(directory)
            .filter(file => file.endsWith('.js'))
            .sort();

        for (const file of files) {
            const modelPath = path.join(directory, file);
            const defineModel = require(modelPath);

            if (typeof defineModel !== 'function') {
                throw new Error(`Invalid model export: ${file}`);
            }

            const model = defineModel(this.sequelize, DataTypes, Op);

            if (!model || !model.name) {
                throw new Error(`Invalid model definition: ${file}`);
            }

            if (this.models[model.name]) {
                throw new Error(`Duplicate model: ${model.name}`);
            }

            this.models[model.name] = model;
        }

        for (const model of Object.values(this.models)) {
            if (typeof model.associate === 'function') {
                model.associate(this.models);
            }
        }

        this.loaded = true;

        return this.models;
    }

    async sync(options = {}) {
        if (!this.loaded) {
            throw new Error('not loaded');
        }

        await this.sequelize.sync({
            force: false,
            alter: false,
            ...options
        });

        return this;
    }

    async init(options = {}) {
        if (this.initializing) return this.initializing;

        this.initializing = (async () => {
            await this.connect();
            await this.loadModels();
            await this.sync(options.sync || {});

            return this;
        })();

        try {
            return await this.initializing;
        } finally {
            this.initializing = null;
        }
    }

    get(name) {
        const model = this.models[name];

        if (!model) {
            throw new Error(`Model "${name}" does not exist`);
        }

        return model;
    }

    async transaction(callback, options = {}) {
        return this.sequelize.transaction(options, callback);
    }

    async reconnect() {
        await this.close();
        return this.connect();
    }

    async close() {
        if (!this.connected) return;

        await this.sequelize.close();

        this.connected = false;
    }

    async health() {
        try {
            await this.sequelize.authenticate();

            return {
                status: 'connected',
                models: Object.keys(this.models).length,
                tables: Object.keys(this.models)
            };
        } catch (error) {
            return {
                status: 'disconnected',
                error: error.message
            };
        }
    }
}

module.exports = Database;
