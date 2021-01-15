const winston = require('winston');
const fluentNodeLogger = require('fluent-logger');
const { mapValues, mapKeys, isObject, pickBy, some, filter } = require('lodash');

let hideKeyList = [];
let hideKeyRegexp = [];
let logger;


function hideKeys(data) {
    return mapValues(data, (v, k) => {
        if (hideKeyList.indexOf(k) !== -1 || some(hideKeyRegexp, r => k.match(r))) {
            return `**********${typeof v}**********`;
        }
        if (isObject(v)) {
            return hideKeys(v);
        }
        return v;
    });
}

function eventLogParamsDecorator(params) {
    return JSON.stringify(
        filter(params, value => ['object', 'function'].indexOf(typeof value) === -1)
    )
}

function eventLogDecorator(event, params, decorator = eventLogParamsDecorator) {
    return `(${event}: ${decorator(params)}`;
}

function stringifyAfterLevel(data, level = 2) {
    if (level <= 0) {
        return JSON.stringify(data);
    }
    return mapValues(
        mapKeys(data, (v, key) => (isNaN(parseInt(key)) ? key : `__${key}`).replace(/\.|\$/gim, '_')),
        (value) => {
            if (isObject(value)) {
                return stringifyAfterLevel(value, level - 1);
            }
            return value;
        }
    );
}

function initLogger(
    {
        level = 'debug',
        transports = [{ type: 'Console', params: { timestamp: true } }],
        addToContext = {},
        hideKeys = [],
        hideRegex = []
    }
) {
    hideKeyList = hideKeys;
    hideKeyRegexp = hideRegex;
    logger = new Logger(winston.createLogger({
        level,
        exitOnError: false,
        transports: transports.map(({ type, params }) => {
            if (type === 'Fluent') {
                const transport = new (fluentNodeLogger.support.winstonTransport())(
                    params.tag,
                    params
                );
                transport.on('error', (err) => {
                    console.error(err);
                });
                if (transport.sender && transport.sender.on) {
                    transport.sender.on('error', (err) => {
                        console.error(err);
                    });
                }
                return transport;
            }
            return new winston.transports[type](params || {});
        }),
        exceptionHandlers: [
            new winston.transports.Console({ timestamp: true, stderrLevels: ['warn', 'info', 'error'] })
        ]
    }), addToContext);
    return logger;
}

class Logger {
    constructor(logger, defaultContext) {
        this.logger = logger;
        this.context = {};
        this.defaultContext = defaultContext;
    }

    addToContext(data) {
        Object.keys(data).forEach((key) => {
            this.context[key] = data[key];
        });
        return this;
    }

    getLoggerWithContext(context) {
        return (new Logger(this.logger, this.defaultContext))
            .addToContext(this.context)
            .addToContext(context);
    }

    logEvent(object, eventList) {
        Object.keys(eventList).forEach((event) => {
            const level = eventList[event];
            object.on(event, (...params) => {
                this[level](eventLogDecorator(event, params))
            })
        })
    }

    getContext() {
        return {...this.defaultContext, ...this.context};
    }

    static prepareData(data) {
        const realData = JSON.parse(JSON.stringify(data));
        return stringifyAfterLevel(hideKeys(realData));
    }

    info(message, data) {
        this.logger.info(message, Logger.prepareData({
            ...this.getContext(),
            ...data
        }));
        return this;
    }

    warn(message, data) {
        this.logger.warn(message, Logger.prepareData({
            ...this.getContext(),
            ...data
        }));
        return this;
    }

    error(message, data) {
        this.logger.error(message, Logger.prepareData({
            ...this.getContext(),
            ...data
        }));
        return this;
    }

    debug(message, data) {
        this.logger.debug(message, Logger.prepareData({
            ...this.getContext(),
            ...data
        }));
        return this;
    }

    alert(message, data) {
        this.logger.error(
            message,
            Logger.prepareData({
                ...this.getContext(),
                ...data,
                alert: true
            })
        );
        return this;
    }

    sendError(error, data) {
        if (!(error instanceof Error)) {
            error = new Error(error);
        }
        this.error(
            error.message,
            { ...data, stack: error.stack && error.stack.split && error.stack.split('\n').slice(1, 100) }
        );
        return this;
    }

    wrapObject(object, wrapMethodList, objectName) {
        const logger = this;
        const construct = function () {};
        construct.prototype = object;
        const resObject = new construct();
        return Object.keys(wrapMethodList).reduce((obj, methodName) => {
            obj[methodName] = (...args) => {
                logger[wrapMethodList[methodName]](`Call ${objectName}.${methodName}`, { args })
                return object[methodName](...args);
            };
            return obj;
        }, resObject);
    }

    alertError(error, data = {}) {
        this.sendError(error, { ...data, alert: true });
        return this;
    }
}

module.exports = { Logger, initLogger };
