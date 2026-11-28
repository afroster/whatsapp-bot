module.exports = (sequelize, DataTypes, Op) => {
    const User = sequelize.define('User', {
        jid: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: true
            }
        },

        name: {
            type: DataTypes.STRING,
            defaultValue: 'Diegoson'
        },

        isAdmin: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },

        isOwner: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },

        isPremium: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },

        isBanned: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },

        premiumExpiry: {
            type: DataTypes.DATE,
            allowNull: true
        },

        data: {
            type: DataTypes.TEXT,
            defaultValue: '{}'
        }
    }, {
        tableName: 'users',
        timestamps: true,

        hooks: {
            beforeValidate: user => {
                if (user.jid) user.jid = user.jid.trim();
            },

            beforeSave: user => {
                if (user.premiumExpiry && user.premiumExpiry <= new Date()) {
                    user.isPremium = false;
                    user.premiumExpiry = null;
                }
            }
        }
    });

    User.prototype.getData = function () {
        try {
            return JSON.parse(this.data || '{}');
        } catch {
            return {};
        }
    };

    User.prototype.setData = async function (key, value) {
        const data = this.getData();

        data[key] = value;
        this.data = JSON.stringify(data);

        return this.save();
    };

    User.prototype.deleteData = async function (key) {
        const data = this.getData();

        delete data[key];
        this.data = JSON.stringify(data);

        return this.save();
    };

    User.prototype.ban = async function () {
        this.isBanned = true;
        return this.save();
    };

    User.prototype.unban = async function () {
        this.isBanned = false;
        return this.save();
    };

    User.prototype.makePremium = async function (duration) {
        this.isPremium = true;

        if (duration) {
            this.premiumExpiry = new Date(Date.now() + duration);
        } else {
            this.premiumExpiry = null;
        }

        return this.save();
    };

    User.prototype.removePremium = async function () {
        this.isPremium = false;
        this.premiumExpiry = null;

        return this.save();
    };

    User.prototype.isPremiumActive = function () {
        return this.isPremium &&
            (!this.premiumExpiry || this.premiumExpiry > new Date());
    };

    User.prototype.toJSON = function () {
        const values = { ...this.get() };

        delete values.data;

        return values;
    };

    User.findOrCreateUser = async function (jid, name = 'Unknown') {
        const [user, created] = await this.findOrCreate({
            where: { jid },
            defaults: { jid, name }
        });

        if (!created && name !== 'Unknown' && user.name !== name) {
            user.name = name;
            await user.save();
        }

        return user;
    };

    User.findPremium = function () {
        return this.findAll({
            where: {
                isPremium: true,
                [Op.or]: [
                    { premiumExpiry: null },
                    { premiumExpiry: { [Op.gt]: new Date() } }
                ]
            }
        });
    };

    User.findBanned = function () {
        return this.findAll({
            where: { isBanned: true }
        });
    };

    User.countPremium = function () {
        return this.count({
            where: {
                isPremium: true,
                [Op.or]: [
                    { premiumExpiry: null },
                    { premiumExpiry: { [Op.gt]: new Date() } }
                ]
            }
        });
    };

    User.cleanPremium = async function () {
        return this.update({
            isPremium: false,
            premiumExpiry: null
        }, {
            where: {
                isPremium: true,
                premiumExpiry: {
                    [Op.lte]: new Date()
                }
            }
        });
    };

    return User;
};
