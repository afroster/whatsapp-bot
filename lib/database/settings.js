module.exports = (sequelize, DataTypes) => {
    const Setting = sequelize.define('Setting', {
        key: {
            type: DataTypes.STRING,
            primaryKey: true,
            allowNull: false
        },

        value: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'settings',
        timestamps: true
    });

    Setting.prototype.getValue = function (fallback = null) {
        try {
            return this.value === null ? fallback : JSON.parse(this.value);
        } catch {
            return this.value ?? fallback;
        }
    };

    Setting.prototype.setValue = async function (value) {
        this.value = JSON.stringify(value);

        return this.save();
    };

    Setting.findValue = async function (key, fallback = null) {
        const setting = await this.findByPk(key);

        return setting ? setting.getValue(fallback) : fallback;
    };

    Setting.set = async function (key, value) {
        const [setting] = await this.findOrCreate({
            where: { key },
            defaults: { key }
        });

        return setting.setValue(value);
    };

    Setting.remove = async function (key) {
        return this.destroy({
            where: { key }
        });
    };

    Setting.getAll = async function () {
        const settings = await this.findAll();
        const result = {};

        for (const setting of settings) {
            result[setting.key] = setting.getValue();
        }

        return result;
    };

    return Setting;
};
