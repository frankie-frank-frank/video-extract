import { prisma } from "@vx/prisma/client";
import { videoQueue } from "@vx/worker";
import { app } from "./api";
import { processVideo, startCleanup } from "./download";

videoQueue.process(processVideo)

async function main() {
  const port = process.env.API_PORT || 5000;
  app.listen(port, () => {
    console.log(`Listening on http://localhost:${port}/`);
  });

  // TODO check for jobs of existing videos
  // get all videos that need to be downloaded
  // reset any videos
  // create a job for every video without an existing job
  const videos = await prisma.video.findMany({
    where: {
      progress: {
        lt: 100
      }
    }
  })
  await videoQueue.removeJobs("*")
  for (const video of videos) {
    await prisma.video.update({
      where: { uuid: video.uuid },
      data: { progress: 0 }
    })
    await videoQueue.add({
      videoId: video.uuid, originUrl: video.originUrl,
      type: "video"
    })
  }

  // await startCleanup();
}

main()
  .catch((e) => {
    console.log("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
