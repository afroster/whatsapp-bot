const cron = require('node-cron');

class Scheduler {
    constructor() {
        this.jobs = new Map();
    }

    add(name, schedule, callback) {
        if (!cron.validate(schedule)) {
            throw new Error(`Invalid schedule: ${schedule}`);
        }

        this.remove(name);
        const job = cron.schedule(schedule, callback, {
            timezone: 'Africa/Johansburg'
        });
        this.jobs.set(name, job);
        return job;
    }

    remove(name) {
        const job = this.jobs.get(name);
        if (!job) return false;
        job.stop();
        this.jobs.delete(name);
        return true;
    }

    stopAll() {
        for (const job of this.jobs.values()) {
            job.stop();
        }

        this.jobs.clear();
    }
}

module.exports = Scheduler;
