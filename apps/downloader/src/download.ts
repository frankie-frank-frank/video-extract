import { prisma } from "@vx/prisma/client";
import fs from "fs-extra";
import ytdl from "ytdl-core";
import path from "path";
import { spawnSync } from "child_process";
import { videoQueue } from "@vx/worker";
import { Job } from "bull";
import { Video } from "@prisma/client";

const FILES_DIR = path.join(__dirname, "../files");

async function downloadClips() {
  return new Promise<void>(async (res) => {
    const clip = await prisma.videoClip.findFirst({
      where: {
        failed: false,
        downloaded: false,
      },
      include: {
        video: true,
      },
    });
    if (!clip || !clip.video) {
      res();
      return;
    }

    const filePath = path.join(FILES_DIR, `${clip.uuid}.mp4`);
    const args = [
      "-i",
      clip.video.fileUrl as string,
      "-ss",
      clip.startTime.toString(),
      "-to",
      clip.endTime.toString(),
      filePath,
    ];
    spawnSync("ffmpeg", args);

    await prisma.videoClip.update({
      where: { uuid: clip.uuid },
      data: {
        downloaded: true,
        fileUrl: filePath,
      },
    });
    res();
  });
}


function downloadVideos() {
  return new Promise<void>(async (res) => {
    const video = await prisma.video.findFirst({
      where: {
        progress: {
          lt: 100,
        },
        failed: false,
      },
    });
    if (!video) {
      res();
      return;
    }

    // We get the title of the video from the youtube api
    const info = await ytdl.getInfo(video.originUrl);
    const {
      videoDetails: { title },
    } = info;
    await prisma.video.update({
      where: { uuid: video.uuid },
      data: { title },
    });

    const filePath = path.join(FILES_DIR, `${video.uuid}.mp4`);
    await prisma.video.update({
      where: { uuid: video.uuid },
      data: { fileUrl: filePath },
    });

    const stream = ytdl(video.originUrl);
    stream.pipe(fs.createWriteStream(filePath));
    stream.on("progress", async (_, downloaded, total) => {
      const progress = Math.ceil((downloaded / total) * 100);

      try {
        await prisma.video.update({
          where: { uuid: video.uuid },
          data: { progress },
        });
      } catch (e) {
        /* it's ok if the update doesn't happen successfully */
      }
    });
    stream.on("error", async () => {
      await prisma.video.update({
        where: { uuid: video.uuid },
        data: { failed: true },
      });
      res();
    });
    stream.on("end", async () => {
      try {
        await prisma.video.update({
          where: { uuid: video.uuid },
          data: {
            progress: 100,
            fileUrl: filePath,
          },
        });
      } catch (e) {}
      res();
    });
  });
}

async function cleanUpFiles() {
  const files = await fs.readdir(FILES_DIR);
  for (const file of files) {
    const [uuid] = file.split("."); // example: "2c536aa6-296f-4140-aa2b-711b27b928c3.mp4"

    const video = await prisma.video.findFirst({ where: { uuid } });
    const clip = await prisma.videoClip.findFirst({ where: { uuid } });

    if (video || clip) continue;

    // no corresponding clip or video was found, so we delete the file
    await fs.rm(path.join(FILES_DIR, file));
  }
}

async function ensureFileDirectory() {
  try {
    await fs.access(FILES_DIR);
  } catch (e) {
    await fs.mkdirp(FILES_DIR);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));


export const processVideo = async (job: Job) => {
  console.log("Got a job!", job.data)
  await ensureFileDirectory();

  await new Promise<void>(async (resolve, reject) => {
    console.log("Downloading video...")

    const { originUrl, videoId } = job.data;
    let video: Video | null = null
    while (!video) {
      video = await prisma.video.findFirst({
        where: { uuid: videoId }
      })
      await delay(100)
    }

    const info = await ytdl.getInfo(originUrl);
    const {
      videoDetails: { title },
    } = info;
    await prisma.video.update({
      where: { uuid: videoId },
      data: { title },
    });

    const filePath = path.join(FILES_DIR, `${videoId}.mp4`);
    console.log(videoId)
    await prisma.video.update({
      where: { uuid: videoId },
      data: { fileUrl: filePath },
    });

    const stream = ytdl(originUrl);
    stream.pipe(fs.createWriteStream(filePath));
    stream.on("progress", async (_, downloaded, total) => {
      const progress = Math.ceil((downloaded / total) * 100);

      try {
        await prisma.video.update({
          where: { uuid: videoId },
          data: { progress },
        });
      } catch (e) {
        /* it's ok if the update doesn't happen successfully */
      }
    });
    stream.on("error", async () => {
      console.log("Got an error")
      await prisma.video.update({
        where: { uuid: videoId },
        data: { failed: true },
      });
      job.moveToFailed({ message: "Error saving video in file system" });
      reject({ message: "Error saving video in file system" })
    });
    stream.on("end", async () => {
      try {
        await prisma.video.update({
          where: { uuid: videoId },
          data: {
            progress: 100,
            fileUrl: filePath,
          },
        });
      } catch (e) {}
      job.moveToCompleted();

      resolve()
    });
  })
  console.log("Finished downloading!")
}

export async function startCleanup() {
  await ensureFileDirectory();

  console.log("Downloader is running")

  while (true) {
    // if a video or clip is deleted from the database,
    // we'll look out for any .mp4 files we have to remove.
    await cleanUpFiles();
    await delay(10_000);
  }
}
