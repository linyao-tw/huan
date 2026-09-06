# 架構決策紀錄

這裡記錄 HUAN 幾個影響全域的決定，以及做這些決定的理由。

寫下來的目的不是儀式，而是讓幾個月後（或換一批人之後）想改動這些地方的人，先知道當初為什麼不那樣做。

| 編號                                               | 決策                                         |
| -------------------------------------------------- | -------------------------------------------- |
| [ADR-0001](/dev/adr/0001-websocket-plus-rest)      | WebSocket 只送通知，REST 才是事實來源        |
| [ADR-0002](/dev/adr/0002-desired-reported-state)   | 用 desired / reported state 而不是命令式 RPC |
| [ADR-0003](/dev/adr/0003-temporary-object-storage) | 物件儲存只做暫存，不當永久素材庫             |
| [ADR-0004](/dev/adr/0004-recursive-split-layout)   | 版面使用遞迴分割樹而不是絕對定位             |
| [ADR-0005](/dev/adr/0005-local-first-playback)     | 本機優先播放                                 |
| [ADR-0006](/dev/adr/0006-electron)                 | 播放器使用 Electron                          |
| [ADR-0007](/dev/adr/0007-postgres-job-queue)       | 工作佇列用 PostgreSQL，不引入 Redis          |
