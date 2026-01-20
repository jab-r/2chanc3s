export type PostDoc = {
  deviceId: string;
  username?: string | null;
  messageId: string;
  time: string;
  content: string;
  contentType?: string;
  mediaId?: string | null;  // Reference to postMedia document
  geolocator?: {
    h3_res6?: string;   // ~36 km² metro-scale
    h3_res7?: string;   // ~5 km² district-scale
    accuracyM?: number;
  } | null;
  locationSource?: "device" | "userProvided";
  geolocatorStatus?: "resolved" | "missing_device_location";
};

export type MediaInfo = {
  type: 'image' | 'video' | 'live';
  mediaId?: string;  // Included for live streams to call /streaming-url endpoint
  thumbnail?: string;
  medium?: string;
  large?: string;
  public?: string;
  stream?: string;
  duration?: number;
  // Live stream fields
  iframe?: string;
  status?: 'created' | 'live' | 'ended';
  title?: string;
};

export type PublicPost = {
  username: string;
  messageId: string;
  time: string;
  content: string;
  contentType?: string;
  media?: MediaInfo;
  geolocatorH3?: string;
  accuracyM?: number;
};
