(() => {
    'use strict';

    angular.module('aws-iot-demo', ['ui.router', 'aws', 'config'])

        .constant('iotThingType', 'rpi-camera')

        .config(['AWSCognitoServiceProvider', 'AWSIoTServiceProvider', 'configCognito', 'configIoT',
            (AWSCognitoServiceProvider, AWSIoTServiceProvider, configCognito, configIoT) => {

                // Configure Cognito region and identity.
                AWSCognitoServiceProvider.setRegion(configCognito.region);
                AWSCognitoServiceProvider.setIdentity(configCognito.endpoint);

                // Configure IoT endpoint.
                AWSIoTServiceProvider.setEndpoint(configIoT.endpoint);
                AWSIoTServiceProvider.setRegion(configIoT.region);
            }
        ])


        .run(['$rootScope', '$q', 'AWSCognitoService', 'AWSIoTService', 'configIoT',
            ($rootScope, $q, AWSCognitoService, AWSIoTService, configIoT) => {

                function onConnectCallback() {
                    console.log('[IOT EVENT] onConnectCallback: Connected');
                    console.log('[IOT EVENT] onConnectCallback: Subscribing');
                    $q.all([
                        AWSIoTService.subscribe('$aws/things/' + configIoT.thingName + '/shadow/get/accepted'),
                        AWSIoTService.subscribe('$aws/things/' + configIoT.thingName + '/shadow/get/rejected'),
                        AWSIoTService.subscribe('$aws/things/' + configIoT.thingName + '/shadow/update/accepted'),
                    ]).then(() => {
                        console.log('[IOT EVENT] onConnectCallback: Subscribed');
                        setTimeout(() => {
                            $rootScope.$broadcast('iotConnectionStatus', 'connected');
                        });
                        return AWSIoTService.publish('$aws/things/' + configIoT.thingName + '/shadow/get', '');
                    }).then(() => {
                        console.log('[IOT EVENT] onConnectCallback: Waiting for response of Get ThingShadow');
                    }).catch((err) => {
                        console.error('[IOT EVENT] onConnectCallback: Error');
                    });
                }

                function onFailureCallback(err) {
                    console.error('[IOT EVENT] onFailureCallback: Failed to connect', err);
                }

                function onConnectionLost(err) {
                    console.error('[IOT EVENT] onConnectionLost: Connection lost', err);
                    $rootScope.$broadcast('iotConnectionStatus', 'disconnected');
                    AWSIoTService.connect();
                }

                function onMessageArrived(message) {
                    $rootScope.$broadcast('messageArrived', message);
                }

                function onMessageDelivered(message) {
                    console.log('[IOT EVENT] onMessageDelivered:', message.payloadString);
                }

                console.log('Connect via Cognito and get temporary credentials.');
                AWSCognitoService.login().then(function(credentials) {

                    console.log('Connection successful - Credentials received:');
                    console.log('Access Key ID:    ', AWS.config.credentials.accessKeyId);
                    console.log('Secret Access Key:', AWS.config.credentials.secretAccessKey);

                    // Attach callbacks to my IoT Service to handle the different events.
                    AWSIoTService.setOnConnectCallback(onConnectCallback);
                    AWSIoTService.setOnFailureCallback(onFailureCallback);
                    AWSIoTService.setOnConnectionLost(onConnectionLost);
                    AWSIoTService.setOnMessageArrived(onMessageArrived);
                    AWSIoTService.setOnMessageDelivered(onMessageDelivered);

                    AWSIoTService.connect();

                    $rootScope.$broadcast('cognito-logged-in');

                }).catch(function(err) {
                    console.error(err);
                });

            }
        ])

        .config(['$stateProvider', '$urlRouterProvider', '$urlMatcherFactoryProvider',
            function($stateProvider, $urlRouterProvider, $urlMatcherFactoryProvider) {
                $urlRouterProvider.otherwise('/');
                $stateProvider.state('home', {
                    url: '/?thing',
                    templateUrl: 'partials/home.html'
                });
            }
        ])

        .controller('HomeController', ['$scope', '$rootScope', '$q', '$stateParams', 'AWSIoTService', 'settings', 'configIoT', 'iotThingType',
            ($scope, $rootScope, $q, $stateParams, AWSIoTService, settings, configIoT, iotThingType) => {

                console.log('[HomeController]', $stateParams);

                $scope.pageDetails = {
                    pageTitle: settings.pageTitle,
                    thing: {
                        ip: '',
                        name: configIoT.thingName,
                        connected: 'disconnected'
                    }
                };

                $scope.ip = '';
                $scope.pageTitle = settings.pageTitle;
                $scope.thingName = configIoT.thingName;
                if ($stateParams.thingName) $scope.thingName = $stateParams.thingName;
                $scope.thingConnected = 'disconnected';

                var triggerTopic = null;
                var uploadedTopic = null;
                $scope.s3Bucket = null;

                $rootScope.$on('shadowUpdate', function(event, data) {

                    var desired = data.state.desired;
                    if (desired) {

                        console.log('[EVENT] shadowUpdate: desired:', JSON.stringify(desired, null, 2));

                        if (desired['rpi-camera'] && desired['rpi-camera'].s3Bucket)
                            $scope.$apply(() => {
                                $scope.s3Bucket = desired['rpi-camera'].s3Bucket;
                            });

                        if (desired['rpi-camera'] && desired['rpi-camera'].iotTriggerTopic) triggerTopic = desired['rpi-camera'].iotTriggerTopic;

                        if (desired['rpi-camera'] && desired['rpi-camera'].iotUploadedTopic) {

                            var promise = null;
                            if (uploadedTopic) promise = AWSIoTService.unsubscribe(uploadedTopic);

                            $q.all([
                                promise
                            ]).then(() => {
                                console.log('[IOT EVENT] onConnectCallback: unsubscribed from', uploadedTopic);
                                uploadedTopic = desired['rpi-camera'].iotUploadedTopic;
                                return AWSIoTService.subscribe(uploadedTopic);
                            }).then(() => {
                                console.log('[IOT EVENT] onConnectCallback: subscribed to', uploadedTopic);
                            }).catch((err) => {
                                console.error('[IOT EVENT] onConnectCallback: Error');
                            });
                        }
                    }

                });

                $rootScope.$on('messageArrived', (event, message) => {
                    // console.log('message', message, );
                    console.log('[IOT EVENT] onMessageArrived(' + message.destinationName + '):'); //, message.payloadString);
                    if (message.destinationName === uploadedTopic) {
                        $rootScope.$broadcast('imageUrl', 'https://s3-ap-southeast-1.amazonaws.com/' + $scope.s3Bucket + '/' + JSON.parse(message.payloadString).filename);
                    }
                    if ((message.destinationName === '$aws/things/' + $scope.thingName + '/shadow/update/accepted') ||
                        (message.destinationName === '$aws/things/' + $scope.thingName + '/shadow/get/accepted')) {
                        $rootScope.$broadcast('shadowUpdate', JSON.parse(message.payloadString));
                    }
                });

                $scope.snap = function() {
                    if (triggerTopic) AWSIoTService.publish(triggerTopic, JSON.stringify({
                        event: 'click from website'
                    }));
                };

            }
        ])

        .directive('myImage', ['$rootScope',
            function($rootScope) {
                return {
                    scope: {
                        image: '='
                    },
                    restrict: 'E',
                    template: '<img ng-src="{{image}}" style="width: 100%;">',
                    controller: function($scope, $rootScope) {
                        $rootScope.$on('imageUrl', function(event, data) {
                            $scope.$apply(function() {
                                // $scope.image = data;
                                $scope.image = data;
                            });
                        });

                    }
                }
            }
        ])

        .directive('thingInfo', ['$rootScope', '$stateParams', 'configIoT', ($rootScope, $stateParams, configIoT) => {
            return {
                template: 'ThingName: {{thing.name}} {{thing.ip}} {{thing.connected}}',
                controller: ($scope, $rootScope) => {

                    $scope.thing = {
                        ip: '',
                        name: ($stateParams.thingName ? $stateParams.thingName : configIoT.thingName),
                        connected: 'disconnected'
                    };

                    $rootScope.$on('shadowUpdate', (event, data) => {
                        console.log('[IOT EVENT] shadow updated', data);

                        var reported = data.state.reported;
                        var metadata = data.metadata;

                        if (reported) console.log('[EVENT] shadowUpdate: reported:', JSON.stringify(reported, null, 2));

                        if (reported && reported.connected !== undefined) {
                            $scope.$apply(() => {
                                $scope.thing.connected = (reported.connected ? 'connected' : 'disconnected');
                            });
                        }

                        if (reported && reported.ip !== undefined && reported.ip.wlan0 !== undefined && reported.ip.wlan0.ip !== undefined) {
                            console.log('[EVENT] getShadow: reported IP:', reported.ip.wlan0.ip + ' (' + moment(metadata.reported.ip.wlan0.ip.timestamp * 1000).fromNow() + ')');
                            $scope.$apply(() => {
                                $scope.thing.ip = reported.ip.wlan0.ip + ' (' + moment(metadata.reported.ip.wlan0.ip.timestamp * 1000).fromNow() + ')';
                            });
                        }

                    });

                }
            }
        }])

        .directive('connectionStatus', ['$rootScope', ($rootScope) => {
            return {
                template: 'WebSockets: {{status}}',
                controller: ($scope, $rootScope) => {
                    $scope.status = 'disconnected';
                    $rootScope.$on('iotConnectionStatus', (event, data) => {
                        console.log('[EVENT] iot:', data);
                        $scope.$apply(() => {
                            $scope.status = data;
                        });
                    });
                }
            }
        }])

    // .directive('imageList', ['$rootScope', 'configIoT', ($rootScope, configIoT) => {
    //     return {
    //         scope: {
    //             bucket: '='
    //         },
    //         restrict: 'E',
    //         template: '<div class="row" style="padding-bottom: 10px;" ng-repeat="rows in chunkedData"><div class="col-sm-3 thumbnail-hover" style="padding-top: 15px; padding-bottom: 15px;" ng-repeat="item in rows"><img ng-click="click(item.Key)" ng-src="https://s3-ap-southeast-1.amazonaws.com/{{bucket}}/{{item.Key}}" style="width: 100%"></div></div>',
    //         controller: function($scope, $rootScope) {

    //             function chunk(arr, size) {
    //                 var newArr = [];
    //                 for (var i = 0; i < arr.length; i += size) {
    //                     newArr.push(arr.slice(i, i + size));
    //                 }
    //                 return newArr;
    //             }

    //             function loadImages() {
    //                 if ($scope.bucket) {

    //                     console.log('[S3 ListObjects] Load images');

    //                     var s3 = new AWS.S3();

    //                     var params = {
    //                         Bucket: $scope.bucket,
    //                         Prefix: 'thumbnails/' + configIoT.thingName + '/',
    //                         MaxKeys: 100
    //                     };
    //                     s3.listObjects(params, function(err, data) {
    //                         if (err) console.error(err, err.stack); // an error occurred
    //                         else {
    //                             $scope.$apply(() => {
    //                                 $scope.chunkedData = chunk(data.Contents, 4);
    //                             });
    //                         }
    //                     });

    //                 }
    //             }

    //             $rootScope.$on('imageUrl', function(event, data) {
    //                 loadImages();
    //             });

    //             $scope.$watch('bucket', () => {
    //                 loadImages();
    //             });

    //             $scope.click = function(key) {
    //                 console.log(key);

    //                 if ($scope.bucket) {

    //                     console.log('[S3 GetObject] Get metadata');

    //                     var s3 = new AWS.S3();

    //                     var params = {
    //                         Bucket: $scope.bucket,
    //                         Key: key
    //                     };
    //                     s3.headObject(params, function(err, data) {
    //                         if (err) console.error(err, err.stack); // an error occurred
    //                         else {
    //                             console.log(data);
    //                             // $scope.$apply(() => {
    //                             //     $scope.chunkedData = chunk(data.Contents, 4);
    //                             // });
    //                         }
    //                     });

    //                 }
    //             };

    //         }
    //     }
    // }])

    ;

})();