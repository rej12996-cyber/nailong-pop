import { BUILD_CHANNEL } from './cloud-config.js';

export const isBeta = BUILD_CHANNEL.startsWith('beta-');
export const storageKey = (key, channel = BUILD_CHANNEL) => channel.startsWith('beta-') ? `${key}.${channel}` : key;
