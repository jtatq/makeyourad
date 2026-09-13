import { createServerFn } from "@tanstack/react-start";
import { websiteReadInputSchema } from "./website-profile";

export const readBusinessWebsiteFn = createServerFn({ method: "POST" })
  .validator(websiteReadInputSchema)
  .handler(async ({ data }) => {
    const { readBusinessWebsite } = await import("./website-read.server");
    return readBusinessWebsite(data.url);
  });
