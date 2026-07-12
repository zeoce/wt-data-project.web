import { Application } from "./app/application";
import { BRHeatMapPage } from "./app/page/br-heatmap-page";
import { StackedAreaPage } from "./app/page/stacked-area-page";
import { WebRepo } from "./app/link/web-repo";
import { DataRepo } from "./app/link/data-repo";
import { Logo } from "./app/image/logo";
import { DarkModeToggle } from "./app/link/dark-mode-toggle";

Application.build
    .withLogo(Logo)
    .withPages(BRHeatMapPage, StackedAreaPage)
    .withLinks(WebRepo, DataRepo, DarkModeToggle)
    .class
    .run()
