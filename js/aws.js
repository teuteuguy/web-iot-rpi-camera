(function() {
    'use strict';

    angular.module('aws', [])

        .provider('AWSCognitoService', [function() {

            var settings = {
                identity: undefined,
                region: undefined
            };

            return {
                setIdentity: function(identity) {
                    settings.identity = identity;
                },
                setRegion: function(region) {
                    settings.region = region;
                },
                $get: ['$q', function($q) {
                    return {
                        login: function() {
                            var deferred = $q.defer();

                            AWS.config = new AWS.Config();

                            AWS.config.region = settings.region;

                            AWS.config.credentials = new AWS.CognitoIdentityCredentials({
                                IdentityPoolId: settings.identity
                            });

                            AWS.config.credentials.get(function(err) {
                                if (err) {
                                    // console.error('AWSCognitoService.login: failed to get credentials', err);
                                    deferred.reject(err);
                                } else {
                                    // console.log('AWSCognitoService.login: Credentials received', AWS.config.credentials.accessKeyId, AWS.config.credentials.secretAccessKey);
                                    deferred.resolve(AWS.config.credentials);
                                }
                            });

                            return deferred.promise;
                        }
                    };
                }]
            };

        }])

        .provider('AWSIoTService', [function() {

            function SigV4Utils() {}

            SigV4Utils.sign = function(key, msg) {
                var hash = CryptoJS.HmacSHA256(msg, key);
                return hash.toString(CryptoJS.enc.Hex);
            };

            SigV4Utils.sha256 = function(msg) {
                var hash = CryptoJS.SHA256(msg);
                return hash.toString(CryptoJS.enc.Hex);
            };

            SigV4Utils.getSignatureKey = function(key, dateStamp, regionName, serviceName) {
                var kDate = CryptoJS.HmacSHA256(dateStamp, 'AWS4' + key);
                var kRegion = CryptoJS.HmacSHA256(regionName, kDate);
                var kService = CryptoJS.HmacSHA256(serviceName, kRegion);
                var kSigning = CryptoJS.HmacSHA256('aws4_request', kService);
                return kSigning;
            };

            SigV4Utils.getSignedUrl = function(protocol, host, uri, service, region, accessKey, secretKey, sessionToken) {
                var time = moment().utc();
                var dateStamp = time.format('YYYYMMDD');
                var amzdate = dateStamp + 'T' + time.format('HHmmss') + 'Z';
                var algorithm = 'AWS4-HMAC-SHA256';
                var method = 'GET';

                var credentialScope = dateStamp + '/' + region + '/' + service + '/' + 'aws4_request';
                var canonicalQuerystring = 'X-Amz-Algorithm=AWS4-HMAC-SHA256';
                canonicalQuerystring += '&X-Amz-Credential=' + encodeURIComponent(accessKey + '/' + credentialScope);
                canonicalQuerystring += '&X-Amz-Date=' + amzdate;
                canonicalQuerystring += '&X-Amz-SignedHeaders=host';

                var canonicalHeaders = 'host:' + host + '\n';
                var payloadHash = SigV4Utils.sha256('');
                var canonicalRequest = method + '\n' + uri + '\n' + canonicalQuerystring + '\n' + canonicalHeaders + '\nhost\n' + payloadHash;

                var stringToSign = algorithm + '\n' + amzdate + '\n' + credentialScope + '\n' + SigV4Utils.sha256(canonicalRequest);
                var signingKey = SigV4Utils.getSignatureKey(secretKey, dateStamp, region, service);
                var signature = SigV4Utils.sign(signingKey, stringToSign);

                canonicalQuerystring += '&X-Amz-Signature=' + signature;
                if (sessionToken) {
                    canonicalQuerystring += '&X-Amz-Security-Token=' + encodeURIComponent(sessionToken);
                }

                var requestUrl = protocol + '://' + host + uri + '?' + canonicalQuerystring;
                return requestUrl;
            };

            var client;
            var settings = {
                endpoint: null,
                region: null
            };
            var onConnectCallback = function() {
                console.log('AWSIoTService.connect.onSuccess: connected.');
            };
            var onFailureCallback = function(err) {
                console.error('AWSIoTService.connect.onFailure: connect failed.', err);
            };
            var onConnectionLost = function(err) {
                console.error('AWSIoTService.connect.onConnectionLost:', err);
            };
            var onMessageArrived = function(message) {
                console.log('AWSIoTService.connect.onMessageArrived:', message.payloadString);
            };
            var onMessageDelivered = function(message) {
                console.log('AWSIoTService.connect.onMessageDelivered:', message.payloadString);
            };

            var service = {
                setEndpoint: function(newEndpoint) {
                    settings.endpoint = newEndpoint;
                },
                setRegion: function(newRegion) {
                    settings.region = newRegion;
                },
                $get: ['$q', function($q) {
                    return {

                        setOnConnectCallback: (cb) => {
                            onConnectCallback = cb;
                        },
                        setOnFailureCallback: (cb) => {
                            onFailureCallback = cb;
                        },
                        setOnConnectionLost: (cb) => {
                            onConnectionLost = cb;
                        },
                        setOnMessageArrived: (cb) => {
                            onMessageArrived = cb;
                        },
                        setOnMessageDelivered: (cb) => {
                            onMessageDelivered = cb;
                        },
                        connect: function() {

                            var requestUrl = SigV4Utils.getSignedUrl(
                                'wss', // protocol
                                settings.endpoint.toLowerCase(), // host
                                '/mqtt', // uri
                                'iotdevicegateway', // service
                                settings.region, // region
                                AWS.config.credentials.accessKeyId, // accessKey
                                AWS.config.credentials.secretAccessKey, // secretKey
                                AWS.config.credentials.sessionToken // sessionToken
                            );

                            var clientId = String(Math.random()).replace('.', '');

                            client = new Paho.MQTT.Client(requestUrl, clientId);

                            client.connect({
                                onSuccess: onConnectCallback,
                                keepAliveInterval: 15,
                                useSSL: true,
                                timeout: 3,
                                mqttVersion: 4,
                                onFailure: onFailureCallback
                            });

                            client.onConnectionLost = onConnectionLost;
                            client.onMessageArrived = onMessageArrived;
                            client.onMessageDelivered = onMessageDelivered;
                        },
                        subscribe: function(topic, onSuccess, onFailure) {
                            var deferred = $q.defer();
                            client.subscribe(topic, {
                                onSuccess: function() {
                                    console.log('[aws.js] Successfully subscribed to', topic);
                                    deferred.resolve();
                                },
                                onFailure: function() {
                                    console.error('[aws.js] Failed to subscribe to', topic);
                                }
                            });
                            return deferred.promise;
                        },
                        unsubscribe: function(topic, onSuccess, onFailure) {
                            var deferred = $q.defer();
                            client.unsubscribe(topic, {
                                onSuccess: function() {
                                    console.log('[aws.js] Successfully unsubscribed to', topic);
                                    deferred.resolve();
                                },
                                onFailure: function() {
                                    console.error('[aws.js] Failed to unsubscribe to', topic);
                                }
                            });
                            return deferred.promise;
                        },
                        publish: function(topic, message) {
                            console.log('[aws.js] publish', topic, message);
                            var msg = new Paho.MQTT.Message(message);
                            msg.destinationName = topic;
                            client.send(msg);
                        }
                    }
                }]
            };

            return service;

        }])

    ;

})();