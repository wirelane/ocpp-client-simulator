require('log-timestamp');

const websocketUrl = process.env.WEBSOCKET_URL;
const chargingStationSerialNumber = process.env.CHARGING_STATION_SERIAL_NUMBER || '0123456';
const connectorCount = process.env.CONNECTOR_COUNT || 1;
const heartBeatIntervalSeconds = process.env.HEARTBEAT_INTERVAL_SECONDS || 300;
const defaultConnectorId = process.env.DEFAULT_CONNECTOR_ID || 1;
const nfcUid = process.env.NFC_UID;
const nfcUidChargingSeconds = process.env.NFC_UID_CHARGING_SECONDS;
const sendSignedMeterValues = process.env.SEND_SIGNED_METER_VALUES;
const autoAccept = !!process.env.AUTO_ACCEPT;
const plugType = process.env.PLUG_TYPE || 'Type2'
const onSitePayment = process.env.ON_SITE_PAYMENT || false;

const W3CWebSocket = require('websocket').w3cwebsocket;
const client = new W3CWebSocket(websocketUrl);
const inquirer = require('inquirer');
const chalk = require('chalk');

const STATUS_AVAILABLE = 'Available';
const STATUS_PREPARING = 'Preparing';
const STATUS_CHARGING = 'Charging';

const MESSAGE_TYPE_STATUS_NOTIFICATION = 'StatusNotification';
const MESSAGE_TYPE_HEARTBEAT = 'Heartbeat';

const sentMsgRegistry = {};

let remoteRequestedConnectorId = null; // connectorId requested via RemoteStart
let connectorIdInUse = null; // connectorId for running transaction
let currentMeter = 10000;
let transactionId = null;
let pendingSessionInterval = null;
let heartBeatsInterval = null;
let pendingSessionStartDate = null;

let configuration = {
    AuthorizeRemoteTxRequests: {
        key: 'AuthorizeRemoteTxRequests',
        readonly: false,
        value: '0',
    },
    HeartbeatInterval: {
        key: 'HeartbeatInterval',
        readonly: false,
        value: heartBeatIntervalSeconds,
    },
    NumberOfConnectors: {
        key: 'NumberOfConnectors',
        readonly: true,
        value: connectorCount,
    }
};

const rebootRequiredKeys = [
    // Station-specific
];

let statusByConnectorId = []
let infoByConnectorId = []
for (let connectorId = 1; connectorId <= connectorCount; connectorId++) {
    statusByConnectorId[connectorId] = STATUS_AVAILABLE;
    infoByConnectorId[connectorId] = 'Status Update';
}

const updateConnectorStatus = (connectorId, status) => {
    statusByConnectorId[connectorId] = status
    let info = 'Status Update';
    // if preparing or charging assume a cable is plugged in - in this case the Bender
    // controller appends the plugType
    if ([STATUS_PREPARING, STATUS_CHARGING].some((s) => s === status)) {
        info += ' -' + plugType + '-'
    }
    infoByConnectorId[connectorId] = info
}

const getConnectorStatus = (connectorId) => {
    return statusByConnectorId[connectorId];
}

const getConnectorInfo = (connectorId) => {
    return infoByConnectorId[connectorId];
}

const remoteStartAcceptAsk = () => {
    if (autoAccept) {
        console.log(chalk.bgGreen('AUTO-ACCEPT:') + ' A RemoteStart was received and auto-accepted.');

        return Promise.resolve({
            accept: 'yes'
        });
    }

    return inquirer.prompt([
        {
            type: 'expand',
            message: 'A RemoteStart was received. Should the charging station accept it? ',
            name: 'accept',
            choices: [
                {key: 'y', name: 'Yes', value: 'yes',},
                {key: 'n', name: 'No', value: 'no',},
            ],
        },
    ]);
};
const remoteStopAcceptAsk = () => {
    if (autoAccept) {
        console.log(chalk.bgGreen('AUTO-ACCEPT:') + ' A RemoteStop was received and auto-accepted.');

        return Promise.resolve({
            accept: 'yes'
        });
    }

    return inquirer.prompt([
        {
            type: 'expand',
            message: 'A RemoteStop was received. Should the charging station accept it? ',
            name: 'accept',
            choices: [
                {key: 'y', name: 'Yes', value: 'yes',},
                {key: 'n', name: 'No', value: 'no',},
            ],
        },
    ]);
};
const getCompositeScheduleAcceptAsk = () => {
    if (autoAccept) {
        console.log(chalk.bgGreen('AUTO-ACCEPT:') + ' A GetCompositeSchedule was received and auto-accepted.');

        return Promise.resolve({
            accept: 'yes'
        });
    }

    return inquirer.prompt([
        {
            type: 'expand',
            message: 'A GetCompositeSchedule was received. Should the charging station accept it? ',
            name: 'accept',
            choices: [
                {key: 'y', name: 'Yes', value: 'yes',},
                {key: 'n', name: 'No', value: 'no',},
            ],
        },
    ]);
};
const setChargingProfileAcceptAsk = () => {
    if (autoAccept) {
        console.log(chalk.bgGreen('AUTO-ACCEPT:') + ' A SetChargingProfile was received and auto-accepted.');

        return Promise.resolve({
            accept: 'yes'
        });
    }

    return inquirer.prompt([
        {
            type: 'expand',
            message: 'A SetChargingProfile was received. Should the charging station accept it? ',
            name: 'accept',
            choices: [
                {key: 'y', name: 'Yes', value: 'yes',},
                {key: 'n', name: 'No', value: 'no',},
            ],
        },
    ]);
};

const clearChargingProfileAcceptAsk = () => {
    if (autoAccept) {
        console.log(chalk.bgGreen('AUTO-ACCEPT:') + ' A ClearChargingProfile was received and auto-accepted.');

        return Promise.resolve({
            accept: 'yes'
        });
    }

    return inquirer.prompt([
        {
            type: 'expand',
            message: 'A ClearChargingProfile was received. Should the charging station accept it? ',
            name: 'accept',
            choices: [
                {key: 'y', name: 'Yes', value: 'yes',},
                {key: 'n', name: 'No', value: 'no',},
            ],
        },
    ]);
};

const updateFirmwareAsk = () => {
    if (autoAccept) {
        console.log(chalk.bgGreen('AUTO-ACCEPT:') + ' An UpdateFirmware was received and auto-accepted.');

        return Promise.resolve({
            accept: 'yes'
        });
    }

    return inquirer.prompt([
        {
            type: 'expand',
            message: 'An UpdateFirmware was received. Should the charging station succeed in updating? ',
            name: 'accept',
            choices: [
                {key: 'y', name: 'Yes', value: 'yes',},
                {key: 'n', name: 'No', value: 'no',},
            ],
        },
    ]);
};

const getDiagnosticsAsk = () => {
    if (autoAccept) {
        console.log(chalk.bgGreen('AUTO-ACCEPT:') + ' A GetDiagnostics was received and auto-accepted.');

        return Promise.resolve({
            accept: 'yes'
        });
    }

    return inquirer.prompt([
        {
            type: 'expand',
            message: 'An GetDiagnostics was received. Should the charging station succeed in uploading? ',
            name: 'accept',
            choices: [
                {key: 'y', name: 'Yes', value: 'yes',},
                {key: 'n', name: 'No', value: 'no',},
            ],
        },
    ]);
};

const resetAcceptAsk = () => {
    if (autoAccept) {
        console.log(chalk.bgGreen('AUTO-ACCEPT:') + ' A Reset was received and auto-accepted.');

        return Promise.resolve({
            accept: 'yes'
        });
    }

    return inquirer.prompt([
        {
            type: 'expand',
            message: 'A Reset was received. Should the charging station accept it? ',
            name: 'accept',
            choices: [
                {key: 'y', name: 'Yes', value: 'yes',},
                {key: 'n', name: 'No', value: 'no',},
            ],
        },
    ]);
};

client.onerror = () => {
    console.log(chalk.bgRed('ERROR:') + ` Connection Error (${websocketUrl})`);
};

client.onclose = (event) => {
    if (heartBeatsInterval) {
        clearInterval(heartBeatsInterval);
    }
    console.log(chalk.bgRed('ERROR:') + ` Client Closed (${websocketUrl}), reason: ${event.reason} (${event.code})`);
};

const sendRequest = (op, data) => {
    const msgId = Math.ceil(Math.random() * 100000000).toString(10);

    console.log(chalk.bgBlue('OUT:') + ' Send request:', {
        msgId,
        op,
        data,
    });

    client.send(JSON.stringify([
        2,
        msgId,
        op,
        data,
    ]));
    sentMsgRegistry[msgId] = {op, data};
};

const sendConfirmation = (msgId, data) => {
    console.log(chalk.bgBlue('OUT:') + ' Send confirmation:', [
        msgId,
        JSON.stringify(data),
    ]);

    client.send(JSON.stringify([
        3,
        msgId,
        data,
    ]));
};

const sendHeartbeat = (msgId) => {
    console.log('sendHeartbeat');
    sendRequest(MESSAGE_TYPE_HEARTBEAT, {});
}

const sendStatusNotification = (trigger, triggeredConnectorId = null) => {
    console.log('sendStatusNotification:', trigger, triggeredConnectorId);

    for (let connectorId = 1; connectorId <= connectorCount; connectorId++) {
        // if status notification is supposed to be sent for a specific connector ignore the other ones
        console.log(connectorId)
        if (null !== triggeredConnectorId && triggeredConnectorId !== connectorId) {
            continue
        }

        console.log('connectorId: ' + connectorId, trigger);

        sendRequest(MESSAGE_TYPE_STATUS_NOTIFICATION, {
            connectorId: connectorId,
            errorCode: 'NoError',
            status: getConnectorStatus(connectorId),
            timestamp: (new Date()).toISOString(),
            info: getConnectorInfo(connectorId)
        });
    }
};


const sendDataTransfer = (vendorId, messageId, data) => {
    sendRequest('DataTransfer', {
        vendorId: vendorId,
        messageId: messageId,
        data: JSON.stringify(data)
    });
}

const startTransaction = (idTag, connectorId) => {
    connectorIdInUse = connectorId

    setTimeout(() => {
        sendRequest('StartTransaction', {
            connectorId: connectorIdInUse,
            idTag,
            meterStart: currentMeter,
            timestamp: (new Date()).toISOString()
        });

        updateConnectorStatus(connectorIdInUse, STATUS_CHARGING)
        sendStatusNotification('By startTransaction', connectorIdInUse);
    }, 1000);
}

const onStartTransactionConfirm = (idTagInfo, returnedTransactionId) => {
    if (idTagInfo['status'] !== 'Accepted') {
        console.warn('StartTransaction was not confirmed', idTagInfo, transactionId);
        return;
    } else {
        console.info('StartTransaction was confirmed', idTagInfo, transactionId);
    }

    transactionId = returnedTransactionId;
    pendingSessionStartDate = new Date();
    pendingSessionInterval = setInterval(() => {
        currentMeter += 100;
        sendRequest("MeterValues", {
            connectorId: connectorIdInUse,
            transactionId,
            meterValue: [{
                timestamp: (new Date()).toISOString(),
                sampledValue: [{
                    value: currentMeter.toString(10),
                    context: "Sample.Periodic",
                    format: "Raw",
                    measurand: "Energy.Active.Import.Register",
                    location: "Outlet",
                    unit: "Wh"
                }]
            }]
        });
    }, 5000);
};

const stopTransaction = (nfcUid) => {
    if (pendingSessionInterval === null) {
        console.warn('No running transaction');
        return;
    }
    clearInterval(pendingSessionInterval);

    const stopData = {
        idTag: nfcUid,
        meterStop: currentMeter + 100,
        timestamp: (new Date()).toISOString(),
        transactionId,
    };
    if (sendSignedMeterValues) {
        stopData['transactionData'] = [
            {
                timestamp: pendingSessionStartDate.toISOString(),
                sampledValue: [{
                    context: 'Transaction.Begin',
                    format: 'SignedData',
                    value: '<?xml version="1.0" encoding="UTF-8" ?><signedMeterValue><publicKey encoding="base64">NQu4+D9eJu18mP8kX3h6tLiF3hpvuCdTK2TfqC5ZohGJK0HY4sMXi2l9a4AyBBuT</publicKey><meterValueSignature encoding="base64">e+1UrGquU5pq15VxoNuV2SyN1oua1ZXOtK66ZyW5ppnUfmZKvTZSSWncdMfNHb4ZABk=</meterValueSignature><signatureMethod>ECDSA192SHA256</signatureMethod><encodingMethod>EDL</encodingMethod><encodedMeterValue encoding="base64">CQFFTUgAAH+IOU8W7FwIoLkGACEAAAABAAERAP8e/yVXAAAAAAAAABkEHwBqNFuEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE4W7FwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=</encodedMeterValue></signedMeterValue>',
                    measurand: 'Energy.Active.Import.Register',
                }]
            },
            {
                timestamp: (new Date()).toISOString(),
                sampledValue: [{
                    context: 'Transaction.End',
                    format: 'SignedData',
                    value: '<?xml version="1.0" encoding="UTF-8" ?><signedMeterValue><publicKey encoding="base64">NQu4+D9eJu18mP8kX3h6tLiF3hpvuCdTK2TfqC5ZohGJK0HY4sMXi2l9a4AyBBuT</publicKey><meterValueSignature encoding="base64">T6CDMPIpFcqom1z4cOI1HTfjqCvOfCvJjwVlLoEJInO/RcZQLGb5kbj21920UWaXABk=</meterValueSignature><signatureMethod>ECDSA192SHA256</signatureMethod><encodingMethod>EDL</encodingMethod><encodedMeterValue encoding="base64">CQFFTUgAAH+IOfoj7FwIS8cGACYAAAABAAERAP8e/yVXAAAAAAAAABkEHwBqNFuEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAj7FwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=</encodedMeterValue></signedMeterValue>',
                    measurand: 'Energy.Active.Import.Register',
                }]
            }
        ];
    }

    console.log(JSON.stringify(stopData));

    sendRequest('StopTransaction', stopData);

    updateConnectorStatus(connectorIdInUse, STATUS_AVAILABLE);
    sendStatusNotification('By stopTransaction', connectorIdInUse);

    pendingSessionInterval = null;
    pendingSessionStartDate = null;
    //transactionId = null;
    connectorIdInUse = null;
    remoteRequestedConnectorId = null;
};

const sendBootNotification = () => {
    sendRequest('BootNotification',
        {
            chargePointVendor: 'Wirelane',
            chargePointModel: 'NodeJS',
            chargePointSerialNumber: chargingStationSerialNumber
        }
    );
}

const sendFirmwareStatusNotification = (status) => {
    // Downloaded, DownloadFailed, Downloading, Idle, InstallationFailed, Installing, Installed
    sendRequest('FirmwareStatusNotification', {
        status
    });
};

const sendDiagnosticsStatusNotification = (status) => {
    // Uploaded, UploadFailed, Uploading, Idle
    sendRequest('DiagnosticsStatusNotification', {
        status
    });
};

const handleChangeConfiguration = (msgId, payload) => {
    let configurationStatus = 'Rejected';
    if (payload.key in configuration) {
        if (!configuration[payload.key].readonly) {
            configuration[payload.key].value = payload.value
            if (rebootRequiredKeys.includes(payload.key)) {
                configurationStatus = 'RebootRequired'
            } else {
                configurationStatus = 'Accepted'
            }
        }
    }

    sendConfirmation(msgId, {
        status: configurationStatus
    });
};

const handleGetConfiguration = (msgId, payload) => {
    const configurationKey = [];
    const unknownKeys = [];

    // if no key is provided, values for all supported keys should be returned
    if (undefined === payload['key']) {
        payload['key'] = Object.keys(configuration)
    }

    payload['key'].forEach(key => {
        if (undefined !== configuration[key]) {
            configurationKey.push(configuration[key])
        } else {
            unknownKeys.push(key);
        }
    });

    sendConfirmation(msgId, {
        configurationKey: configurationKey,
        unknownKey: unknownKeys,
    });
};

const handleGetDiagnostics = (msgId, payload) => {
    sendConfirmation(msgId, {
        fileName: Math.ceil(Math.random() * 100000000).toString(10).toString() + '.txt'
    });

    getDiagnosticsAsk().then(ret => {
        setTimeout(() => sendDiagnosticsStatusNotification('Uploading'), 1000);
        if (ret.accept === 'yes') {
            setTimeout(() => sendFirmwareStatusNotification('Uploaded'), 3000);
        } else {
            setTimeout(() => sendFirmwareStatusNotification('UploadFailed'), 1000);
            
        }
    });
};

const handleTriggerMessage = (msgId, payload) => {
    switch (payload['requestedMessage']) {
        case MESSAGE_TYPE_HEARTBEAT:
            sendConfirmation(msgId, {status: 'Accepted'});

            triggeredMessageCb = () => sendHeartbeat();
            break;

        case MESSAGE_TYPE_STATUS_NOTIFICATION:
            sendConfirmation(msgId, {status: 'Accepted'});

            triggeredMessageCb = () => sendStatusNotification('By TriggerMessage', payload['connectorId']);
            break;

        default:
            sendConfirmation(msgId, {status: 'NotImplemented'});
            break;
    }

    setTimeout(triggeredMessageCb, 1000);
}

const handleUpdateFirmware = (msgId, payload) => {
    sendConfirmation(msgId, {});

    updateFirmwareAsk().then(ret => {
        if (ret.accept === 'yes') {
            // send notifications in same order as Nano
            setTimeout(() => sendFirmwareStatusNotification('Downloading'), 1000);
            setTimeout(() => sendFirmwareStatusNotification('Downloaded'), 3000);
            setTimeout(() => sendFirmwareStatusNotification('Installing'), 5000);
            setTimeout(() => sendBootNotification(), 7000);
            setTimeout(() => sendFirmwareStatusNotification('Installed'), 9000);
        } else {
            setTimeout(() => sendFirmwareStatusNotification('Downloading'), 1000);
            setTimeout(() => sendFirmwareStatusNotification('DownloadFailed'), 3000);
        }
    });
};

client.onmessage = (e) => {
    if (typeof e.data === 'string') {
        console.log(e.data)
        const msg = JSON.parse(e.data);
        const msgId = msg[1];
        const action = msg[2];
        const payload = msg[3];

        if (msg[0] === 3) {
            const prevOp = sentMsgRegistry[msg[1]];

            if (!prevOp) {
                console.error(`OCPP Server accepted: ${msgId} - previous operation not found, skipping`);

                return;
            }

            console.log(`OCPP Server accepted: ${msgId} (${prevOp.op})`);

            switch (prevOp.op) {
                case 'Authorize':
                    console.log(msg);
                    onAuthorizeResponse(msg[2]['idTagInfo']);
                    break;
                case 'StartTransaction':
                    onStartTransactionConfirm(action['idTagInfo'], action['transactionId']);
                    break;
                case 'DataTransfer':
                    if ('Authorize' === sentMsgRegistry[msg[1]].data.messageId)
                    {
                        startTransaction(nfcUid, defaultConnectorId)
                    }
                    break;
                case 'StopTransaction':
                    setTimeout(() => {
                        sendRequest('DataTransfer', {
                            "vendorId": "OnSitePay",
                            "messageId": "Receipt",
                            "data": `{\"merchant\":{\"name\":\"Wirelane GmbH\",\"address\":\"Von-der-Tann Str 12, 80539, MUC\",\"taxId\":\"DE306534423\"},\"chargePoint\":{\"serialNumber\":\"100134119\",\"id\":\"100134119\"},\"chargingProcess\":{\"energyDelivered\":0,\"chargingTime\":407,\"netValueEnergy\":0,\"netPriceEnergy\":0.17,\"netPriceTime\":0.17,\"netValueTime\":1.14,\"netValueTotal\":2.48,\"vat\":0.47,\"vatRate\":19,\"grossValue\":2.95},\"paymentTransaction\":{\"id\":\"51\",\"timestamp\":\"2025-01-29 15:16:27\",\"language\":\"\",\"receiptNo\":\"\",\"aid\":\"A0000003591010028001\",\"vuNumber\":\"\",\"terminalId\":\"71503130\",\"stan\":\"\",\"currency\":\"EUR\",\"paymentType\":\"\",\"card\":{\"type\":\"girocard\",\"pan\":\"6805710705158256363\",\"expiryDate\":\"2812\"},\"authorization\":{\"type\":\"\",\"code\":\"\",\"acknowledgementCode\":\"\"}},\"transactionId\":${transactionId},\"receiptString\":\"         Wirelane GmbH          \\nVon-der-Tann Str 12, 80539, MUC \\n      USt-IdNr.DE306534423      \\n          SN 100134119          \\n        Ch.ID 100134119         \\n                                \\nDatum:       2025-01-29 15:23:43\\nEnergietarif:       0.20 EUR\/kWh\\nZeittarif:          0.20 EUR\/min\\nBlockiergeb\u00FChr:     0.20 EUR\/min\\nEnergie:              1.1950 kWh\\nZeit:                  00h06m47s\\nBlockierzeit:          00h06m47s\\n                                \\nGesamt:                 EUR 2.95\\nMwSt. 19%:              EUR 0.47\\nNetto:                  EUR 2.48\\n                                \\n                                \\n  Thank you for using Wirelane  \\n\\n------------------------------\\n            - Kundenbeleg -\\nWirelane GmbH - Germany\\nVon-der-Tann-Strasse 12\\n80539 Muenchen\\n\\n             Kartenzahlung\\n                girocard\\n\\nBetrag:                         EUR 2,95\\n\\nDatum: 29.01.2025         Zeit: 15:23:43\\nTerminal-Nr.:                   71503130\\nTrace-Nr.:                        000052\\nBeleg:                                10\\nZusatzinformation: 715031301738160176\\nKarten-Nr.:          xxxxxxxxxxxxxxx6363\\nFolge-Nr.:                          0017\\nKartendaten:                  Kontaktlos\\nAID:                              664423\\nVU-Nr.:                       CE37D03130\\n\\n         Autorisierung erfolgt\\n\"}`
                        });
                    }, 5000);;
                    break;
            
            }

            return;
        } else {
            console.log(chalk.bgGreen('IN:') + ` ${(new Date()).toISOString()} Received ${action} message with id ${msgId}:`, JSON.stringify(payload, null, '\t'));
        }

        switch (action) {
            case 'ChangeConfiguration':
                handleChangeConfiguration(msgId, payload);
                break;
            
            case 'GetConfiguration':
                handleGetConfiguration(msgId, payload);
                break;

            case 'GetDiagnostics':
                handleGetDiagnostics(msgId, payload);
                break;

            case 'TriggerMessage':
                handleTriggerMessage(msgId, payload);
                break;

            case 'UpdateFirmware':
                handleUpdateFirmware(msgId, payload);
                break;

            case 'RemoteStartTransaction':
                const idTag = payload['idTag'];
                // use default connector if no connectorId has been specified
                remoteRequestedConnectorId = payload['connectorId'] || defaultConnectorId;
                remoteStartAcceptAsk().then(ret => {
                    if (ret.accept === 'yes') {
                        sendConfirmation(msgId, {status: 'Accepted'});

                        setTimeout(() => {
                            if ('1' === configuration.AuthorizeRemoteTxRequests.value) {
                                sendAuthorize(idTag)
                            } else {
                                startTransaction(idTag, remoteRequestedConnectorId);
                            }
                        }, 500);
                    } else {
                        sendConfirmation(msgId, {status: 'Rejected'});
                    }
                });
                break;

            case 'RemoteStopTransaction':
                remoteStopAcceptAsk().then(ret => {
                    if (ret.accept === 'yes') {
                        sendConfirmation(msgId, {status: 'Accepted'});

                        setTimeout(() => {
                            stopTransaction(nfcUid);
                        }, 500);
                    } else {
                        sendConfirmation(msgId, {status: 'Rejected'});
                    }
                });
                break;

            case 'GetCompositeSchedule':
                getCompositeScheduleAcceptAsk().then(ret => {
                    if (ret.accept === 'yes') {
                        sendConfirmation(msgId, {
                            status: 'Accepted',
                            connectorId: 1,
                            scheduleStart: (new Date()).toISOString(),
                            chargingSchedule: {
	  		                    startSchedule: (new Date()).toISOString(),
                                duration: 100,
	  		                    chargingRateUnit: "W",
	  		                    chargingSchedulePeriod: [
	  			                    {
	  				                    "startPeriod": 0,
	  				                    "limit": 2.5,
	  				                    "numberPhases": 3
	  			                    },
                                      {
                                        "startPeriod": 100,
                                        "limit": 2.5,
                                        "numberPhases": 3
                                    }
	  		                    ],
                                minChargingRate: 8.1
	  	                    }
                        });
                    } else {
                        sendConfirmation(msgId, {status: 'Rejected'});
                    }
                });
                break;

            case 'SetChargingProfile':
                setChargingProfileAcceptAsk().then(ret => {
                    if (ret.accept === 'yes') {
                        sendConfirmation(msgId, {status: 'Accepted'});
                    } else {
                        sendConfirmation(msgId, {status: 'Rejected'});
                    }
                });
                break;

            case 'ClearChargingProfile':
                clearChargingProfileAcceptAsk().then(ret => {
                    if (ret.accept === 'yes') {
                        sendConfirmation(msgId, {status: 'Accepted'});
                    } else {
                        sendConfirmation(msgId, {status: 'Unknown'});
                    }
                });
                break;

            case 'Reset':
                resetAcceptAsk().then(ret => {
                    if (ret.accept === 'yes') {
                        sendConfirmation(msgId, {status: 'Accepted'});
                        setTimeout(() => sendBootNotification(), 10000);
                    } else {
                        sendConfirmation(msgId, {status: 'Rejected'});
                    }
                });

            default:
                console.log(`Unknown action: ${action}`);
        }
    }
};

const sendAuthorize = (nfcId) => {
    sendRequest('DataTransfer', {
        "vendorId": "OnSitePay",
        "messageId": "Authorize",
        "data": `{\"terminalId\": \"71503130\", \"paymentId\":\"${nfcId}\"}`
    });
};

const onAuthorizeResponse = (idTagInfo) => {
    if (idTagInfo['status'] !== 'Accepted') {
        console.warn('Authorize was not accepted', idTagInfo);
        if (nfcUid != null) {
            process.exit(1);
        }
        return;
    }
    startTransaction(nfcUid, remoteRequestedConnectorId || defaultConnectorId);
};

client.onopen = () => {
    console.log(`WebSocket Client Connected to ${websocketUrl} with auto-accept ${autoAccept}`);

    sendBootNotification();

    heartBeatsInterval = setInterval(sendHeartbeat, heartBeatIntervalSeconds * 1000);

    if (nfcUid != null) {
        setTimeout(() => {
            updateConnectorStatus(defaultConnectorId, STATUS_PREPARING)
            sendStatusNotification('By NFC', defaultConnectorId);
        }, 10000);

        setTimeout(() => {
            console.log(`Sending authorization request with nfc-uid ${nfcUid}`);
            sendAuthorize(nfcUid);

            if (nfcUidChargingSeconds > 0) {
                setTimeout(() => {
                    stopTransaction(nfcUid);
                    //process.exit()
                }, nfcUidChargingSeconds * 1000);
            }
        }, 15000);
    }
};
