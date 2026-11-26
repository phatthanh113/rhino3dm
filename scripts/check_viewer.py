"""Check the RhinoView app in headless Edge: load, layers, views, A/B, measure.

Run while the API is up:
    python scripts\\check_viewer.py
"""

import sys
import time

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

APP_URL = "http://127.0.0.1:8000/"
SCREENSHOT_PATH = r"D:\rhino\report\app_viewer.png"
READY_TIMEOUT_MS = 300000
VIEW_NAME = f"Check {int(time.time())}"


def cleanup_views(page):
    views = page.request.get(f"{APP_URL}api/projects/TPRO/views").json()
    for view in views:
        if view["name"].startswith("Check") or view["name"] == "Debug view":
            page.request.delete(f"{APP_URL}api/projects/TPRO/views/{view['id']}")


def wait_ready(page):
    page.wait_for_function(
        "document.querySelectorAll('.layer-row').length >= 46",
        timeout=READY_TIMEOUT_MS,
        polling=500,
    )
    page.wait_for_function(
        "document.querySelector('.statusbar')?.textContent.includes('6,333,244')",
        timeout=READY_TIMEOUT_MS,
        polling=500,
    )


def main():
    console_errors = []
    page_errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            channel="msedge",
            headless=True,
            args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        )
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        started_at = time.perf_counter()
        page.goto(APP_URL, wait_until="load", timeout=60000)
        cleanup_views(page)
        page.reload(wait_until="load", timeout=60000)
        wait_ready(page)
        print(f"model ready in {time.perf_counter() - started_at:.1f}s")

        layers_before = page.locator(".layer-row").count()
        print("layer rows:", layers_before)
        print("status:", page.locator(".statusbar").inner_text().replace("\n", " "))

        # 1. Toggle one layer off, then all back on.
        page.locator(".layer-row input[type=checkbox]").first.uncheck(force=True)
        page.wait_for_timeout(200)
        count_text = page.locator(".layers-count").inner_text()
        print("after one off:", count_text)
        assert count_text.startswith("45 / 46"), count_text
        page.locator(".text-button").click(force=True)
        page.wait_for_timeout(200)
        assert page.locator(".layers-count").inner_text().startswith("46 / 46")

        # 1b. Clicking a layer zooms the camera to that layer.
        camera_before = page.evaluate("window.__viewer.get_camera()")
        page.locator(".layer-name").first.click(force=True)
        page.evaluate(
            """() => {
                const engine = window.__viewer;
                if (engine.flight) {
                    engine.render_loop(engine.flight.started + engine.flight.duration + 50);
                }
            }"""
        )
        camera_after = page.evaluate("window.__viewer.get_camera()")
        assert camera_before["position"] != camera_after["position"], "layer zoom did not move the camera"
        print("layer zoom ok:", camera_before["position"], "->", camera_after["position"])

        page.locator(".viewer-tools .tool").nth(5).click(force=True)
        page.evaluate(
            """() => {
                const engine = window.__viewer;
                if (engine.flight) {
                    engine.render_loop(engine.flight.started + engine.flight.duration + 50);
                }
            }"""
        )
        page.wait_for_timeout(300)

        # 2. Save the current view, change it, then re-apply the saved view.
        page.locator(".save-layer").click(force=True)
        page.locator("#view-name").fill(VIEW_NAME, force=True)
        page.locator(".modal .button-primary").click(force=True)
        saved_item = page.locator(".preset-item", has_text=VIEW_NAME)
        saved_item.wait_for(timeout=15000)
        print("saved view:", saved_item.inner_text().replace("\n", " | "))

        page.locator(".layer-row input[type=checkbox]").nth(1).uncheck(force=True)
        page.wait_for_timeout(200)
        assert page.locator(".layers-count").inner_text().startswith("45 / 46")
        saved_item.click(force=True)
        page.wait_for_timeout(400)
        assert page.locator(".layers-count").inner_text().startswith("46 / 46")
        print("view re-applied:", page.locator(".layers-count").inner_text())

        # 3. Section cut on Y through the panel.
        page.locator(".tabs .tab").nth(2).click(force=True)
        page.locator(".section-switch input").check(force=True)
        page.wait_for_timeout(300)
        slider = page.locator(".slider-row input[type=range]")
        slider.fill("20", force=True)
        page.wait_for_timeout(300)
        print("section value:", page.locator(".slider-value").inner_text())

        # 4. Measure two points on the model.
        page.locator(".viewer-tools .tool").nth(4).click(force=True)
        canvas = page.locator(".viewport canvas")
        box = canvas.bounding_box()
        center_x = box["x"] + box["width"] / 2
        center_y = box["y"] + box["height"] / 2
        page.mouse.click(center_x, center_y)
        page.wait_for_timeout(500)
        page.mouse.click(center_x + 55, center_y + 35)
        page.wait_for_timeout(800)
        assert page.locator(".measure-panel").count() == 1, "measure panel missing"
        distance_text = page.locator(".measure-distance").inner_text()
        print("measured:", distance_text)
        assert " m" in distance_text
        page.locator(".measure-panel-head button").click(force=True)
        page.locator(".viewer-tools .tool").nth(4).click(force=True)

        # 5. A/B compare with the other version.
        page.locator(".version-button").click(force=True)
        page.locator(".version-menu").wait_for(timeout=10000)
        page.locator(".version-compare:not([disabled])").first.click(force=True)
        page.locator(".ab-pill").wait_for(timeout=600000)
        page.wait_for_function(
            "window.__viewer && window.__viewer.instances.size >= 2",
            timeout=600000,
            polling=500,
        )
        ab_text = page.locator(".ab-pill").inner_text().replace("\n", " ")
        print("A/B pill:", ab_text)
        page.locator(".ab-pill button").nth(1).click(force=True)
        page.wait_for_timeout(1200)
        assert "active" in (page.locator(".ab-pill button").nth(1).get_attribute("class") or "")
        page.locator(".ab-pill .ab-close").click(force=True)
        page.wait_for_timeout(800)
        assert page.locator(".ab-pill").count() == 0
        assert page.evaluate("window.__viewer.instances.size") == 1
        print("A/B toggle ok")

        # 6. View cube + fit.
        page.locator(".cube .f-top").click(force=True)
        page.wait_for_timeout(800)
        page.locator(".viewer-tools .tool").nth(5).click(force=True)
        page.wait_for_timeout(800)
        print("view cube and fit ok")

        # 7. Scan modal.
        page.locator(".topbar .button-primary").click(force=True)
        page.locator(".modal").wait_for(timeout=10000)
        code_text = page.locator(".modal code").inner_text()
        print("scan path:", code_text)
        assert "versions" in code_text
        page.locator(".modal .button-primary").click(force=True)
        page.locator(".toast").wait_for(timeout=60000)
        print("scan toast:", page.locator(".toast").inner_text())
        page.wait_for_timeout(800)

        page.screenshot(path=SCREENSHOT_PATH, timeout=180000)
        print("screenshot:", SCREENSHOT_PATH)

        # 8. Delete the test view through the API so app.db stays clean.
        views = page.request.get(f"{APP_URL}api/projects/TPRO/views").json()
        for view in views:
            if view["name"] == VIEW_NAME:
                page.request.delete(f"{APP_URL}api/projects/TPRO/views/{view['id']}")
        print("cleanup views left:", len(page.request.get(f"{APP_URL}api/projects/TPRO/views").json()))
        print("console errors:", console_errors)
        print("page errors:", page_errors)
        assert not page_errors, page_errors
        assert not console_errors, console_errors
        browser.close()


if __name__ == "__main__":
    main()
