# USB Camera Lab

A local macOS page for viewing USB cameras side by side, naming them by USB signature, and checking live frame rate. Each preview has mirror and vertical flip controls.

## Quickstart

Requires macOS 14+, Node.js 18+, Xcode command line tools, and Chrome.

```sh
git clone https://github.com/bananatron/usb-camera-lab.git
cd usb-camera-lab
npm start
```

Open <http://127.0.0.1:8765> and click **Start previews**. Camera names stay on your Mac in an ignored file. Cameras without serial numbers are identified by USB port.
