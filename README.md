# OCPP Client Simulator

This project is very simple, yet helpful command-line based simulator of a charging station connecting to an OCPP Server using OCPP 1.6 (JSON/WS).

At [Wirelane](https://www.wirelane.com), we use for simulating difference OCPP-related scenarios before performing actual E2E integration tests with actual charging stations.

Some use-cases often encountered are built in (Authorization using UIDs of a RFID card, RemoteStart/RemoteStop). But as the code is very straight-forward and doesn't try to be clever or sophisticated, it can be easily customized to test out other scenarios, too.

## Docker Build

```shell
$ docker build . -t ocpp-client-simulator
```

## Local Node.JS-based build

```shell
npm ci
```

## Run

For each command, both the docker command and the local Node.JS-based variant is given.

```shell
$ docker run -it --init \
    -e WEBSOCKET_URL=wss://ocpp.mycompany.com/cpms/ocppj/DEWLNERTP1 \
    ocpp-client-simulator
$ WEBSOCKET_URL=wss://ocpp.mycompany.com/cpms/ocppj/DEWLNERTP1 node index.js
```

This connects the simulator to the OCPP server. It waits for a RemoteStart and then explicitly ask whether to accept it or not.
To auto-accept RemoteStarts and RemoteStops, use the `AUTO_ACCEPT`-parameter:

```shell
$ docker run -it --init \
    -e WEBSOCKET_URL=wss://ocpp.mycompany.com/cpms/ocppj/DEWLNERTP1 \
    -e AUTO_ACCEPT=true \
    ocpp-client-simulator
$ WEBSOCKET_URL=wss://ocpp.mycompany.com/cpms/ocppj/DEWLNERTP1 AUTO_ACCEPT=true node index.js
```

Add NFC_UID parameter to trigger an authorization request after 15 seconds, NFC_UID_CHARGING_SECONDS to stop it after another x seconds again, and SEND_SIGNED_METER_VALUES=1 to send a fake signed XML at StopTransaction:
```shell
$ docker run -it --init \
    -e WEBSOCKET_URL=wss://ocpp.mycompany.com/cpms/ocppj/DEWLNERTP1 \
    -e NFC_UID=042F3C7A3F3480 \
    -e NFC_UID_CHARGING_SECONDS=5 \
    -e SEND_SIGNED_METER_VALUES=1 \
    ocpp-client-simulator
$ WEBSOCKET_URL=wss://ocpp.mycompany.com/cpms/ocppj/DEWLNERTP1 NFC_UID=042F3C7A3F3480 NFC_UID_CHARGING_SECONDS=5 SEND_SIGNED_METER_VALUES=1 node index.js
```

Add number of connectors (CONNECTOR_COUNT) and the connector in use (CONNECTOR_IN_USE) optionally. You can use following command for that
```shell
$ docker run -it --init \
    -e WEBSOCKET_URL=wss://ocpp.mycompany.com/cpms/ocppj/DEWLNERTP1 \
    -e CONNECTOR_COUNT=3 \
    -e CONNECTOR_IN_USE=2 \
    ocpp-client-simulator
$ WEBSOCKET_URL=wss://ocpp.mycompany.com/cpms/ocppj/DEWLNERTP1 CONNECTOR_COUNT=3 CONNECTOR_IN_USE=2 SEND_SIGNED_METER_VALUES=1 node index.js
```
