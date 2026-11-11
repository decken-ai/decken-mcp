# `@decken/mcp` — Official MCP Server & Agent Skill

Turn **Claude Code**, **OpenAI Codex**, **Cursor**, and **Windsurf** into a **better Gamma** via Decken's Native OpenXML (`.pptx`) Slide Generation Kernel (`POST /v1/decks`).

## 1-Command Setup

### Claude Code
```bash
claude mcp add decken -e DECKEN_API_KEY="$DECKEN_API_KEY" -- npx -y github:decken-ai/decken-mcp
npx skills add decken-ai/decken-mcp
```

### OpenAI Codex (`~/.codex/config.toml`)
```toml
[mcp_servers.decken]
command = "npx"
args = ["-y", "github:decken-ai/decken-mcp"]
env_vars = ["DECKEN_API_KEY"]
```

## Primary Unified Tool: `decken_generate`

- **Scenario 1 (`from_outline`)**: Pass `outline` (Markdown or slide array with `diagram` flows and `table` matrices) + `outputPath`.
- **Scenario 2 (`from_outline_with_reference`)**: Pass `outline` + `reference` (local path or `https://` URL to a corporate `.pptx` template OR reference `.png`/`.jpg` slide) + `outputPath`.
- **Scenario 3 (`improve_material`)**: Pass `source` (rough `.pptx` deck OR slide screenshots/renders) + optional `prompt` + optional `reference` + `outputPath`.

Also exposes `decken_reconstruct_slide`, `decken_reconstruct_deck`, `decken_compare_models`, `decken_job_status`, `decken_list_jobs`, and `decken_capabilities`.

## License

MIT
