import Queue from 'bull'

export type QueueOptions = {
  [key: string]: any;
};

export type VideoInputInfo = {
  originUrl: string;
  videoId: string;
  type?: "clip" | "video";
};

export type ClipInputInfo = {
  videoId: string;
  startTime: number;
  endTime: number;
  title: string | null;
}

export type AddVideoType = {
  videoInput: VideoInputInfo[];
  options?: QueueOptions;
};

const createVideoQueue = (options: QueueOptions = {}) => {
  return new Queue<VideoInputInfo>("video-queue", options);
};

export const videoQueue = createVideoQueue();

const createClipQueue = (options: QueueOptions = {}) => {
  return new Queue<ClipInputInfo>("clip-queue", options);
};

export const clipQueue = createClipQueue();
