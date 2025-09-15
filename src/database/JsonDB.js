const fs = require('fs');
const path = require('path');

class JsonDB {
    constructor(filePath = './database.json', options = {}) {
        this.filePath = path.resolve(filePath);
        this.autoSave = options.autoSave !== false;
        this.prettify = options.prettify !== false;
        this.data = {};
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const rawData = fs.readFileSync(this.filePath, 'utf8');
                this.data = JSON.parse(rawData);
            } else {
                this.save();
            }
        } catch (error) {
            console.error('Error loading database:', error);
            this.data = {};
        }
    }

    save() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const jsonData = this.prettify
                ? JSON.stringify(this.data, null, 2)
                : JSON.stringify(this.data);

            fs.writeFileSync(this.filePath, jsonData, 'utf8');
            return true;
        } catch (error) {
            console.error('Error saving database:', error);
            return false;
        }
    }

    // Collection operations
    collection(name) {
        if (!this.data[name]) {
            this.data[name] = [];
            if (this.autoSave) this.save();
        }
        return new Collection(this, name);
    }

    getCollections() {
        return Object.keys(this.data);
    }

    dropCollection(name) {
        delete this.data[name];
        if (this.autoSave) this.save();
        return true;
    }

    // Direct data operations
    set(key, value) {
        this.data[key] = value;
        if (this.autoSave) this.save();
        return value;
    }

    get(key, defaultValue = null) {
        return this.data[key] !== undefined ? this.data[key] : defaultValue;
    }

    has(key) {
        return key in this.data;
    }

    delete(key) {
        delete this.data[key];
        if (this.autoSave) this.save();
        return true;
    }

    clear() {
        this.data = {};
        if (this.autoSave) this.save();
        return true;
    }

    // Utility methods
    size() {
        return Object.keys(this.data).length;
    }

    keys() {
        return Object.keys(this.data);
    }

    values() {
        return Object.values(this.data);
    }

    entries() {
        return Object.entries(this.data);
    }

    backup(backupPath) {
        try {
            const backupFile = path.resolve(backupPath || `${this.filePath}.backup`);
            fs.copyFileSync(this.filePath, backupFile);
            return backupFile;
        } catch (error) {
            console.error('Error creating backup:', error);
            return null;
        }
    }

    restore(backupPath) {
        try {
            const backupFile = path.resolve(backupPath);
            if (fs.existsSync(backupFile)) {
                fs.copyFileSync(backupFile, this.filePath);
                this.load();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error restoring backup:', error);
            return false;
        }
    }
}

class Collection {
    constructor(db, name) {
        this.db = db;
        this.name = name;
    }

    // CRUD Operations
    insert(item) {
        const id = item.id || this._generateId();
        const record = { ...item, id };
        this.db.data[this.name].push(record);
        if (this.db.autoSave) this.db.save();
        return record;
    }

    insertMany(items) {
        const records = items.map(item => ({
            ...item,
            id: item.id || this._generateId()
        }));
        this.db.data[this.name].push(...records);
        if (this.db.autoSave) this.db.save();
        return records;
    }

    find(query = {}) {
        return this.db.data[this.name].filter(item =>
            this._matchQuery(item, query)
        );
    }

    findOne(query = {}) {
        return this.db.data[this.name].find(item =>
            this._matchQuery(item, query)
        );
    }

    findById(id) {
        return this.findOne({ id });
    }

    update(query, update, options = {}) {
        const items = this.find(query);
        let updatedCount = 0;

        items.forEach(item => {
            const index = this.db.data[this.name].indexOf(item);
            if (index !== -1) {
                if (options.replace) {
                    this.db.data[this.name][index] = { ...update, id: item.id };
                } else {
                    Object.assign(this.db.data[this.name][index], update);
                }
                updatedCount++;
                if (options.upsert === false) return;
            }
        });

        if (updatedCount === 0 && options.upsert) {
            this.insert(update);
            updatedCount = 1;
        }

        if (this.db.autoSave) this.db.save();
        return updatedCount;
    }

    updateById(id, update, options = {}) {
        return this.update({ id }, update, options);
    }

    delete(query) {
        const items = this.find(query);
        let deletedCount = 0;

        items.forEach(item => {
            const index = this.db.data[this.name].indexOf(item);
            if (index !== -1) {
                this.db.data[this.name].splice(index, 1);
                deletedCount++;
            }
        });

        if (this.db.autoSave) this.db.save();
        return deletedCount;
    }

    deleteById(id) {
        return this.delete({ id });
    }

    deleteMany(query = {}) {
        const deletedCount = this.delete(query);
        return deletedCount;
    }

    // Query methods
    count(query = {}) {
        return this.find(query).length;
    }

    exists(query) {
        return this.findOne(query) !== undefined;
    }

    distinct(field) {
        const values = this.db.data[this.name].map(item => item[field]);
        return [...new Set(values)];
    }

    // Aggregation
    aggregate(pipeline) {
        let result = [...this.db.data[this.name]];

        for (const stage of pipeline) {
            if (stage.$match) {
                result = result.filter(item => this._matchQuery(item, stage.$match));
            }
            if (stage.$sort) {
                const [field, order] = Object.entries(stage.$sort)[0];
                result.sort((a, b) => {
                    if (order === 1) return a[field] > b[field] ? 1 : -1;
                    return a[field] < b[field] ? 1 : -1;
                });
            }
            if (stage.$limit) {
                result = result.slice(0, stage.$limit);
            }
            if (stage.$skip) {
                result = result.slice(stage.$skip);
            }
        }

        return result;
    }

    // Utility methods
    clear() {
        this.db.data[this.name] = [];
        if (this.db.autoSave) this.db.save();
        return true;
    }

    all() {
        return this.db.data[this.name];
    }

    _matchQuery(item, query) {
        for (const [key, value] of Object.entries(query)) {
            if (typeof value === 'object' && value !== null) {
                // Handle operators
                if (value.$gt !== undefined && !(item[key] > value.$gt)) return false;
                if (value.$gte !== undefined && !(item[key] >= value.$gte)) return false;
                if (value.$lt !== undefined && !(item[key] < value.$lt)) return false;
                if (value.$lte !== undefined && !(item[key] <= value.$lte)) return false;
                if (value.$ne !== undefined && item[key] === value.$ne) return false;
                if (value.$in !== undefined && !value.$in.includes(item[key])) return false;
                if (value.$nin !== undefined && value.$nin.includes(item[key])) return false;
                if (value.$regex !== undefined) {
                    const regex = new RegExp(value.$regex, value.$options || '');
                    if (!regex.test(item[key])) return false;
                }
            } else {
                if (item[key] !== value) return false;
            }
        }
        return true;
    }

    _generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
}

module.exports = JsonDB;