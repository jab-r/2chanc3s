export type PostDoc = {
  deviceId: string;
  username?: string | null;
  messageId: string;
  time: string;
  content: string;
  contentType?: string;
  geolocator?: { h3?: string; accuracyM?: number } | null;
  locationSource?: "device" | "userProvided";
  geolocatorStatus?: "resolved" | "missing_device_location";
};

export type PublicPost = {
  username: string;
  messageId: string;
  time: string;
  content: string;
  geolocatorH3?: string;
  accuracyM?: number;
};

