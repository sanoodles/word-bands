// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import FeedbackLink from "./FeedbackLink";

afterEach(cleanup);

describe("FeedbackLink", () => {
  it("mails the address once the browser has it", async () => {
    render(<FeedbackLink />);
    const link = await screen.findByRole("link", { name: "samuelgomezcrespo@gmail.com" });
    expect(link).toHaveAttribute(
      "href",
      "mailto:samuelgomezcrespo@gmail.com?subject=wordbands%20feedback",
    );
  });

  // What a scraper reading the HTML gets: a spelled-out address and no mailto.
  it("sends no address in the server markup", () => {
    const html = renderToStaticMarkup(<FeedbackLink />);
    expect(html).toBe("samuelgomezcrespo at gmail dot com");
  });
});
