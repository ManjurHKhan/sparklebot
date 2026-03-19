# CI/CD Plan: Automated Docker + Helm Publishing

## Current State

CI runs on push to main and PRs: tests, Docker build verification, Helm lint. Nothing is published.

## Goal

On tagged release (`v*`), automatically publish:
1. Docker image to GitHub Container Registry (ghcr.io)
2. Helm chart to a Helm OCI registry (also ghcr.io)

Users install with:
```bash
# Docker
docker pull ghcr.io/manjurhkhan/sparklebot:1.0.0

# Helm
helm install sparklebot oci://ghcr.io/manjurhkhan/charts/sparklebot --version 0.1.0
```

## Workflow Design

### Trigger

```yaml
on:
  push:
    tags: ['v*']
```

Tag `v1.0.0` triggers the release. The tag drives both the Docker image tag and the Helm chart `appVersion`.

### Job 1: Test (gate)

Same as current CI. Release jobs depend on this passing.

### Job 2: Docker Publish

```yaml
docker-publish:
  needs: test
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@v4

    - uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - uses: docker/metadata-action@v5
      id: meta
      with:
        images: ghcr.io/manjurhkhan/sparklebot
        tags: |
          type=semver,pattern={{version}}
          type=semver,pattern={{major}}.{{minor}}
          type=sha

    - uses: docker/build-push-action@v6
      with:
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}
```

Produces tags like `1.0.0`, `1.0`, and the git SHA. No `latest` tag (explicit versions only).

### Job 3: Helm Publish

```yaml
helm-publish:
  needs: test
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@v4

    - uses: azure/setup-helm@v4

    - name: Login to ghcr.io OCI registry
      run: echo "${{ secrets.GITHUB_TOKEN }}" | helm registry login ghcr.io -u ${{ github.actor }} --password-stdin

    - name: Update chart versions from tag
      run: |
        VERSION=${GITHUB_REF_NAME#v}
        sed -i "s/^version:.*/version: $VERSION/" helm/sparklebot/Chart.yaml
        sed -i "s/^appVersion:.*/appVersion: \"$VERSION\"/" helm/sparklebot/Chart.yaml

    - name: Package and push
      run: |
        helm package helm/sparklebot/
        helm push sparklebot-*.tgz oci://ghcr.io/manjurhkhan/charts
```

Chart version and appVersion are derived from the git tag. No manual version bumping.

### Job 4: GitHub Release (optional)

```yaml
release:
  needs: [docker-publish, helm-publish]
  runs-on: ubuntu-latest
  permissions:
    contents: write
  steps:
    - uses: actions/checkout@v4

    - uses: softprops/action-gh-release@v2
      with:
        generate_release_notes: true
```

Auto-generates release notes from commits since the last tag.

## Release Process

```bash
# 1. Make sure main is clean and CI passes
# 2. Tag and push
git tag v1.0.0
git push origin v1.0.0
```

That's it. GitHub Actions handles the rest.

## values.yaml Change for Consumers

Update the default image repository so Helm users get the right image out of the box:

```yaml
image:
  repository: ghcr.io/manjurhkhan/sparklebot
  tag: ""  # defaults to chart appVersion
```

In deployment.yaml, the image tag fallback:
```yaml
image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
```

## Repo Settings Needed

1. **Package visibility:** After first publish, go to github.com → Packages → sparklebot → Settings → Change visibility to Public
2. **No secrets needed:** `GITHUB_TOKEN` is automatic for ghcr.io within the same repo

## Future Considerations

- **Multi-arch builds:** Add `platforms: linux/amd64,linux/arm64` to docker/build-push-action (better-sqlite3 needs native compilation on each arch, so this is slower)
- **Helm chart repo index:** If you want `helm repo add` support instead of OCI, set up GitHub Pages with chart-releaser-action. OCI is simpler and the modern approach.
- **Signed images:** Add cosign signing step after Docker push for supply chain security
