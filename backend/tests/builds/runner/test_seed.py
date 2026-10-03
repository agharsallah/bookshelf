from app.builds.git import COAUTHOR_TRAILER, Git
from app.builds.seed import (
    render_gitignore,
    render_plan,
    render_readme,
    seed_message,
    seed_repo,
    short_title,
)
from tests.builds.runner.conftest import sh_git

PLAN = {
    "summary": "A tiny transformer you can read in one sitting.",
    "stack": ["Python", "PyTorch"],
    "repo_name": "tiny-transformer",
    "milestones": [
        {"title": "Attention", "commit": "feat(model): scaled dot-product attention",
         "deliverable": "attention.py", "done_when": "unit test passes"},
        {"title": "Training loop", "commit": "feat(train): loop",
         "deliverable": "train.py", "done_when": "loss goes down"},
    ],
    "layout": [{"path": "model.py", "purpose": "the model"}],
    "out_of_scope": ["multi-GPU"],
    "risks": ["slow on CPU"],
    "questions": [],
}  # fmt: skip
TITLE = "Attention Is All You Need: Transformers for Sequence Transduction"
GOAL = "A minimal PyTorch transformer for learning."


def test_readme_names_the_paper_only_with_link_paper() -> None:
    linked = render_readme(plan=PLAN, goal=GOAL, title=TITLE, link_paper=True, coauthor=True,
                           paper_url="https://arxiv.org/abs/1706.03762")  # fmt: skip
    hidden = render_readme(plan=PLAN, goal=GOAL, title=TITLE, link_paper=False, coauthor=True)

    assert linked.startswith("# tiny-transformer\n\nA minimal PyTorch transformer")
    assert "- [ ] Attention\n- [ ] Training loop" in linked
    assert f"Paper: [{TITLE}](https://arxiv.org/abs/1706.03762)" in linked
    assert f"Built with [Claude Code](https://claude.com/claude-code) from {TITLE}." in linked
    assert "Attention Is All You Need" not in hidden
    assert "Built with [Claude Code]" in hidden


def test_readme_without_attribution_has_no_claude_line() -> None:
    readme = render_readme(plan=PLAN, goal=GOAL, title=TITLE, link_paper=False, coauthor=False)
    assert "Claude" not in readme and "Paper:" not in readme


def test_plan_renders_milestones_layout_and_scope() -> None:
    plan = render_plan(PLAN, goal=GOAL)
    assert "### 1. Attention" in plan and "### 2. Training loop" in plan
    assert "- **Commit**: `feat(model): scaled dot-product attention`" in plan
    assert "| `model.py` | the model |" in plan
    assert "## Out of scope\n\n- multi-GPU" in plan


def test_gitignore_per_toolchain() -> None:
    python = render_gitignore(["python"])
    node = render_gitignore(["node", "static"])
    assert "__pycache__/" in python and "node_modules/" not in python
    assert "node_modules/" in node and ".venv/" not in node
    assert ".env" in render_gitignore([])


def test_short_title_drops_the_subtitle_and_cuts_on_a_word() -> None:
    assert short_title(TITLE) == "Attention Is All You Need"
    assert short_title("word " * 30).endswith("…")
    assert len(short_title("word " * 30)) <= 51
    assert seed_message(TITLE, link_paper=False) == "chore: seed repository"


def test_seed_repo_writes_and_commits(repo: Git) -> None:
    files = {"docs/PAPER.md": "# Paper\n\nIdeas.", "docs/PLAN.md": render_plan(PLAN, goal=GOAL),
             ".gitignore": render_gitignore(["python"])}  # fmt: skip
    sha = seed_repo(repo, files, title=TITLE, link_paper=True, coauthor=False)

    assert repo.head() == sha
    assert [c.subject for c in repo.log()] == [
        "chore: seed repository from Attention Is All You Need"
    ]
    assert (repo.cwd / "docs/PAPER.md").read_text() == "# Paper\n\nIdeas.\n"
    assert "### 1. Attention" in (repo.cwd / "docs/PLAN.md").read_text()
    assert "__pycache__/" in (repo.cwd / ".gitignore").read_text()
    body = sh_git(repo.cwd, "log", "-1", "--format=%B")
    assert COAUTHOR_TRAILER not in body
    assert not repo.has_changes()
