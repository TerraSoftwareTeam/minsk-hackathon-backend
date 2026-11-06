import { FactoryProvider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cert, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';

export const FIREBASE_MESSAGING = Symbol('FIREBASE_MESSAGING');

const APP_NAME = 'push';

/**
 * Firebase Cloud Messaging client (HTTP v1 API via firebase-admin), authorized
 * with the service account JSON at FIREBASE_SERVICE_ACCOUNT_PATH.
 * Without the variable push is disabled (null): the app still runs, e.g. locally
 * and in tests. A set but unreadable path fails the startup, it is a misconfiguration.
 */
export const FirebaseMessagingProvider: FactoryProvider<Messaging | null> = {
  provide: FIREBASE_MESSAGING,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const path = config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');
    if (!path) {
      new Logger('Firebase').warn('FIREBASE_SERVICE_ACCOUNT_PATH is not set: push notifications are disabled');
      return null;
    }
    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = JSON.parse(readFileSync(resolve(path), 'utf8')) as ServiceAccount;
    } catch (error) {
      throw new Error(
        `Cannot read the Firebase service account from FIREBASE_SERVICE_ACCOUNT_PATH=${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // Reuse the app on re-creation of the module (e.g. in e2e tests), initializeApp throws on a duplicate name.
    const app =
      getApps().find((existing) => existing.name === APP_NAME) ??
      initializeApp({ credential: cert(serviceAccount) }, APP_NAME);
    return getMessaging(app);
  },
};
