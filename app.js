const { connect } = require('mqtt');
const Influx      = require('influx');
const Debugger    = require('homie-sdk/lib/utils/debugger');

const MQTT_USER          = process.env.MQTT_USER || '';
const MQTT_PASS          = process.env.MQTT_PASS || '';
const MQTT_BROKER_URI    = process.env.MQTT_BROKER_URI || 'mqtt://localhost:1883';
const INFLUX_HOST        = process.env.INFLUX_HOST || 'localhost';
const INFLUX_DATABASE    = process.env.INFLUX_DATABASE || 'influx_db';
const reSET              = new RegExp('/set$', 'g');
const INFLUX_USER        = process.env.INFLUX_USER || '';
const INFLUX_PASS        = process.env.INFLUX_PASSWORD || '';
const TOPICS             = process.env.MQTT_TOPICS || '';

const debug = new Debugger('*');

debug.initEvents();

const STATE = {}; // store received values from broker to avoid re-inserting to InfluxDB
/**
 * Object which has entity IDs as keys and object with alias name and topic as value
 * Example:
 * {
 *     "entityId": {
 *         "name"  : "temperature-sensor",
 *         "topic" : "sweet-home/device/node/temperature-sensor"
 *     }
 * }
 */
const ALIASES = {};

(() => {
    const influx = new Influx.InfluxDB({
        host     : INFLUX_HOST,
        database : INFLUX_DATABASE,
        username : INFLUX_USER,
        password : INFLUX_PASS,
        schema   : [
            {
                measurement : 'timelines',
                fields      : {
                    string : Influx.FieldType.STRING,
                    number : Influx.FieldType.FLOAT
                },
                tags : [ 'topic', 'alias' ]
            }
        ]
    });

    function parseAndStoreAliasTopic(topic, value) {
        // eslint-disable-next-line prefer-const
        let [ , entityId, attribute ] = topic.split('/');

        attribute = attribute.replace('$', '');

        if (!ALIASES[entityId]) ALIASES[entityId] = {};

        ALIASES[entityId][attribute] = value;

        const { name: alias, topic: aliasTopic } = ALIASES[entityId];
        const valueByTopic = STATE[aliasTopic];

        /**
         * Check if alias object is full(has defined name and topic fields)
         * and there is a value by alias topic, if it is, then insert this data
         * to InfluxDB so that alias will appear on Grafana
         */
        if (alias && aliasTopic && valueByTopic) {
            const fields = { string: valueByTopic };

            const number = parseFloat(valueByTopic);

            if (!isNaN(number) && isFinite(number)) fields.number = number;

            influx.writePoints([
                {
                    measurement : 'timelines',
                    tags        : {
                        topic : aliasTopic,
                        alias
                    },
                    fields
                }
            ]).catch(e => debug.warning('TimeSeries.writePoints', e));
        }
    }

    try {
        const mqtt = connect(MQTT_BROKER_URI, {
            username           : MQTT_USER,
            password           : MQTT_PASS,
            rejectUnauthorized : false,
            protocolVersion    : 5
        });

        let topics = TOPICS.split(';').filter(topic => topic);

        topics = topics.length ? topics : [
            'sweet-home/#',
            'topics-aliases/#',
            'scenarios/+/+'
        ];

        mqtt.on('connect', () => {
            debug.logger('MQTT IS CONNECTED');
            mqtt.subscribe(topics, () => {
                debug.logger(topics);
            });
        });

        mqtt.on('message', (topic, message) => {
            const value = message.toString();

            // Parse "topic-aliases/#" topic to store aliases for topics
            if (topic.search(/^topics-aliases/) !== -1) {
                parseAndStoreAliasTopic(topic, value);

                return;
            }

            // ignore set event topic
            if (topic.search(reSET) !== -1) return;
            // ignore heartbeat
            if (topic.search(/\$heartbeat$/) !== -1) return;
            // If there is already current topic-message pair in STATE object
            if (STATE[topic] && STATE[topic] === value) return;

            STATE[topic] = value;

            const alias = Object
                .values(ALIASES)
                .reduce((acc, obj) => (obj.topic === topic ? obj.name : acc), null);

            const fields = { string: value };

            const number = parseFloat(value);

            if (!isNaN(number) && isFinite(number)) fields.number = number;

            const tags = { topic };

            // Add alias tag if found alias for current topic
            if (alias) tags.alias = alias;

            influx.writePoints([
                {
                    measurement : 'timelines',
                    tags,
                    fields
                }
            ]).catch(e => debug.warning('TimeSeries.writePoints', e));
        });
    } catch (e) {
        debug.error(e);
        process.exit(1);
    }
})();
