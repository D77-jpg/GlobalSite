import type mongoose from "mongoose";
import { Site, SiteVersion, SiteDeployment } from "../models";
import { ensure } from "../errors";
/** Shared document locks make concurrent edits conflict with publication transactions. */
export async function assertSiteEditable(
  id: string,
  session: mongoose.ClientSession,
) {
  ensure(
    !(await SiteDeployment.exists({ siteId: id, active: true }).session(
      session,
    )),
    409,
    "PUBLICATION_IN_PROGRESS",
  );
  await Site.updateOne({ _id: id }, { $inc: { lockVersion: 1 } }, { session });
}
export async function assertFactsEditable(
  ids: string[],
  session: mongoose.ClientSession,
) {
  if (!ids.length) return;
  const deployments = await SiteDeployment.find({ active: true })
    .select("versionId")
    .session(session);
  ensure(
    !(await SiteVersion.exists({
      _id: { $in: deployments.map((d) => d.versionId) },
      "snapshot.facts.id": { $in: ids },
    }).session(session)),
    409,
    "PUBLICATION_IN_PROGRESS",
  );
}
