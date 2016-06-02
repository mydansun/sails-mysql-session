var debug_log = require('debug')('sails-mysql-session:log');
var debug_error = require('debug')('sails-mysql-session:error');
var deprecate = require('depd')('sails-mysql-session');
var MySQLConnectionManager = require('mysql-connection-manager');
var util = require('util');

var defaultOptions = {
	checkExpirationInterval: 900000,// How frequently expired sessions will be cleared; milliseconds.
	expiration: 86400000,// The maximum age of a valid session; milliseconds.
	createDatabaseTable: true,// Whether or not to create the sessions database table, if one does not already exist.
	schema: {
		tableName: 'sessions',
		columnNames: {
			session_id: 'session_id',
			expires: 'expires',
			data: 'data'
		}
	}
};

module.exports = function(session) {

	/**
	 * Connect's Store.
	 */

	//var Store = connect.session.Store;

	/**
	 * Initialize PostSQLStore with the given `options`.
	 *
	 * @param {Object} options
	 * @api public
	 */

	 var Store = session.Store;

	function MySQLStore(options) {

		debug_log('Creating session store');

		options = options || {};
		Store.call(this, options);
		this.options = options;

		this.setDefaultOptions();

		if (this.options.debug) {
			deprecate('The \'debug\' option has been removed. This module now uses the debug module to output logs and error messages. Run your app with `DEBUG=sails-mysql-session* node your-app.js` to have all logs and errors outputted to the console.');
		}

		this.manager = new MySQLConnectionManager(options, null);

		this.connection = this.manager.connection;

		var done = function() {

			this.setExpirationInterval();

		}.bind(this);

		if (!this.options.createDatabaseTable) {
			return done();
		}

		this.createDatabaseTable(done);
	}



	MySQLStore.prototype.createDatabaseTable = function(cb) {

		debug_log('Creating sessions database table');

		var fs = require('fs');

		fs.readFile(__dirname + '/../schema.sql', 'utf-8', function(error, sql) {

			if (error) {
				return cb(error);
			}

			sql = sql.replace(/`[^`]+`/g, '??');

			var params = [
				this.options.schema.tableName,
				this.options.schema.columnNames.session_id,
				this.options.schema.columnNames.expires,
				this.options.schema.columnNames.data,
				this.options.schema.columnNames.session_id
			];

			this.connection.query(sql, params, function(error) {

				if (error) {
					debug_error('Failed to create sessions database table.');
					debug_error(error);
					return cb && cb(error);
				}

				cb && cb();
			});

		}.bind(this));
	};


	MySQLStore.prototype.get = function(session_id, cb) {

		debug_log('Getting session: ' + session_id);

		var sql = 'SELECT ?? FROM ?? WHERE ?? = ? LIMIT 1';

		var params = [
			this.options.schema.columnNames.data,
			this.options.schema.tableName,
			this.options.schema.columnNames.session_id,
			session_id
		];

		this.connection.query(sql, params, function(error, rows) {

			if (error) {
				debug_error('Failed to get session.');
				debug_error(error);
				return cb(error, null);
			}

			var session = !!rows[0] ? JSON.parse(rows[0][this.options.schema.columnNames.data]) : null;

			cb(null, session);

		}.bind(this));
	};

	
	MySQLStore.prototype.set = function(session_id, data, cb) {

		debug_log('Setting session: ' + session_id);

		var expires;

		if (data.cookie && data.cookie.expires) {
			expires = data.cookie.expires;
		} else {
			expires = new Date(Date.now() + this.options.expiration);
		}

		// Use whole seconds here; not milliseconds.
		expires = Math.round(expires.getTime() / 1000);

		data = JSON.stringify(data);

		var sql = 'INSERT INTO ?? (??, ??, ??) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ?? = VALUES(??), ?? = VALUES(??)';

		var params = [
			this.options.schema.tableName,
			this.options.schema.columnNames.session_id,
			this.options.schema.columnNames.expires,
			this.options.schema.columnNames.data,
			session_id,
			expires,
			data,
			this.options.schema.columnNames.expires,
			this.options.schema.columnNames.expires,
			this.options.schema.columnNames.data,
			this.options.schema.columnNames.data
		];

		this.connection.query(sql, params, function(error) {

			if (error) {
				debug_error('Failed to insert session data.');
				debug_error(error);
				return cb && cb(error);
			}

			cb && cb(null);
		});
	};

	MySQLStore.prototype.destroy = function(session_id, cb) {

		debug_log('Destroying session: ' + session_id);

		var sql = 'DELETE FROM ?? WHERE ?? = ? LIMIT 1';

		var params = [
			this.options.schema.tableName,
			this.options.schema.columnNames.session_id,
			session_id
		];

		this.connection.query(sql, params, function(error) {

			if (error) {
				debug_error('Failed to destroy session.');
				debug_error(error);
				return cb && cb(error);
			}

			cb && cb();
		});
	};

	MySQLStore.prototype.length = function(cb) {

		debug_log('Getting number of sessions');

		var sql = 'SELECT COUNT(*) FROM ??';

		var params = [
			this.options.schema.tableName
		];

		this.connection.query(sql, params, function(error, rows) {

			if (error) {
				debug_error('Failed to get number of sessions.');
				debug_error(error);
				return cb && cb(error);
			}

			var count = !!rows[0] ? rows[0]['COUNT(*)'] : 0;

			cb && cb(null, count);
		});
	};

	MySQLStore.prototype.clear = function(cb) {

		debug_log('Clearing all sessions');

		var sql = 'DELETE FROM ??';

		var params = [
			this.options.schema.tableName
		];

		this.connection.query(sql, params, function(error) {

			if (error) {
				debug_error('Failed to clear all sessions.');
				debug_error(error);
				return cb && cb(error);
			}

			cb && cb();
		});
	};

	MySQLStore.prototype.clearExpiredSessions = function(cb) {

		debug_log('Clearing expired sessions');

		var sql = 'DELETE FROM ?? WHERE ?? < ?';

		var params = [
			this.options.schema.tableName,
			this.options.schema.columnNames.expires,
			Math.round(Date.now() / 1000)
		];

		this.connection.query(sql, params, function(error) {

			if (error) {
				debug_error('Failed to clear expired sessions.');
				debug_error(error);
				return cb && cb(error);
			}

			cb && cb();
		});
	};

	MySQLStore.prototype.setExpirationInterval = function(interval) {

		debug_log('Setting expiration interval: ' + interval + 'ms');

		this.clearExpirationInterval();

		this._expirationInterval = setInterval(function() {

			this.clearExpiredSessions();

		}.bind(this), interval || this.options.checkExpirationInterval);
	};

	MySQLStore.prototype.clearExpirationInterval = function() {

		debug_log('Clearing expiration interval');

		clearInterval(this._expirationInterval);
	};

	MySQLStore.prototype.setDefaultOptions = function() {

		debug_log('Setting default options');

		this.options = setDefaults(this.options, defaultOptions, true);
	};

	return MySQLStore;
};

function setDefaults(obj, defaults, recursive) {

	if (!isObject(obj)) {
		return obj;
	}

	recursive = recursive === true;

	for (var key in defaults) {

		if (typeof obj[key] === 'undefined') {
			obj[key] = defaults[key];
		}

		if (recursive && isObject(obj[key])) {
			obj[key] = setDefaults(obj[key], defaults[key], recursive);
		}
	}

	return obj;
}

function isObject(obj) {

	var type = typeof obj;
	return type === 'function' || type === 'object' && !!obj;
}