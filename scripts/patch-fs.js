const fs = require('fs');

const originalReadlink = fs.readlink;
fs.readlink = function (path, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = null;
    }
    originalReadlink(path, options, (err, linkString) => {
        if (err && (err.code === 'EISDIR' || err.code === 'UNKNOWN')) {
            err.code = 'EINVAL';
        }
        callback(err, linkString);
    });
};

const originalReadlinkSync = fs.readlinkSync;
fs.readlinkSync = function (path, options) {
    try {
        return originalReadlinkSync(path, options);
    } catch (err) {
        if (err && (err.code === 'EISDIR' || err.code === 'UNKNOWN')) {
            err.code = 'EINVAL';
        }
        throw err;
    }
};

if (fs.promises && fs.promises.readlink) {
    const originalReadlinkPromise = fs.promises.readlink;
    fs.promises.readlink = async function (path, options) {
        try {
            return await originalReadlinkPromise(path, options);
        } catch (err) {
            if (err && (err.code === 'EISDIR' || err.code === 'UNKNOWN')) {
                err.code = 'EINVAL';
            }
            throw err;
        }
    };
}

// Some tools might use gracefully-fs or other wrappers that might bind 'this'
// but standard monkeypatching usually works.
