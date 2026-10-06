# Inventory Replenishment Mobile

React Native app built with Expo SDK 57 and Expo Router. EAS Build profiles are provided for development, internal preview APKs, and store production builds.

## Requirements

- Node.js 22.13 or newer
- pnpm 10.29.2
- Expo account for cloud builds

## Local development

1. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to the backend API reachable from the device.
2. Install dependencies with `pnpm install`.
3. Start Metro with `pnpm start`.

The Android emulator can reach a backend on the host at `10.0.2.2`. A physical device needs the computer's LAN IP and the phone and computer must share a network. The backend must listen on an address reachable from the device.

## EAS Build

Run `npx eas-cli@latest login`, then `npx eas-cli@latest build:configure` to link this app to an Expo project. Set `EXPO_PUBLIC_API_URL` in the Expo project's EAS environments before building.

- `pnpm build:development` creates an internal development client.
- `pnpm build:preview` creates an installable Android APK for team review.
- `pnpm build:production` creates store-ready builds.

## Current scope

Implemented mobile workflows include secure login, session restoration, permission-aware dashboard metrics, inventory lookup with barcode scanning, stock requests, transfer tracking and receiving with quantity discrepancy notes and photo evidence, stock opname, permission-gated inventory adjustments, cash transactions and closing, and a POS flow for product selection, variant/add-on configuration, cart, cash/QRIS/transfer payment, order completion, receipt preview, and direct ESC/POS receipt printing over Android Bluetooth Classic. Searchable order history, order details, and permission-gated refunds are also available.

For Bluetooth receipt printing, install an Android development/preview APK, pair the thermal printer in Android Bluetooth settings, then select it once from the receipt screen. The app remembers that printer and reconnects to its saved address for later print jobs. The current print layout targets the common 58 mm paper width; check the physical output with the intended printer before relying on it in production. Expo Go and iOS do not use the direct Android Bluetooth print path.

The EAS `preview` profile produces an installable Android APK. Before building, set `EXPO_PUBLIC_API_URL` in the EAS environment to a backend URL reachable from the device. Offline mutation sync is not implemented; mobile operations currently require a live API connection.

## Push notifications

The app registers an Expo push token after sign-in and unregisters it on sign-out. The backend sends notifications for submitted and reviewed stock requests and sent/received transfers. Push delivery uses Expo Push Service; no additional backend package or secret is required. Android remote push must be tested in a development/preview build, not Expo Go.

Before testing on Android:

1. Create/select a Firebase project, download `google-services.json`, and set `expo.android.googleServicesFile` to its path in `app.json`.
2. Generate a Firebase service account private key and upload its JSON in `eas credentials` under Android > production > Google Service Account. Treat this key as a secret and never commit it.
3. Set `EXPO_PUBLIC_API_URL` in the EAS environment to the deployed backend URL.
4. Apply backend migrations (`pnpm prisma:migrate:deploy` from the backend project), then build and install an Android development or preview APK.
5. Sign in and allow notifications when prompted. Expo Push Service delivery is free; Android requires the Firebase/EAS credentials above. iOS additionally needs an Apple Developer account and APNs credentials.
