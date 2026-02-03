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
  // Identity link fields for anonymous/semi-anonymous posts
  replyLinkHandle?: string | null;   // UUID for identity link server lookup
  replyLinkEntropy?: string | null;  // base64url-encoded entropy for client-side decryption
  displayName?: string | null;       // Display name for anonymous posts (e.g., "Anonymous")
  // Parsed entities for querying
  entities?: {
    mentions: string[];   // Case-sensitive usernames
    hashtags: string[];   // Lowercase tags
    urls: string[];
  };
};

// Search request body for POST /api/search
export type SearchRequest = {
  hashtags?: string[];      // Lowercase hashtag values
  mentions?: string[];      // Case-sensitive mention values
  text?: string;            // Plain text substring search
  location?: {
    name?: string;          // For logging/debugging
    h3Cells: string[];      // H3 cell IDs to search within
    resolution: number;     // H3 resolution (6 or 7)
  };
  limit?: number;           // 1-100, default 50
  maxScan?: number;         // 50-2000, default 500
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
  username?: string | null;  // Optional for anonymous posts
  messageId: string;
  time: string;
  content: string;
  contentType?: string;
  media?: MediaInfo;
  geolocatorH3?: string;
  accuracyM?: number;
  // Identity link fields for anonymous posts
  replyLinkHandle?: string | null;
  replyLinkEntropy?: string | null;
  displayName?: string | null;
};
