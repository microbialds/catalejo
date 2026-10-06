# Deployment

This guide describes how to run an instance of Catalejo Genómico on Cloudflare, from an empty account to an instance that serves a release behind a login, and the tasks that come up once it runs. It is meant to be read from top to bottom. Publishing releases and deploying the application will be automated in milestone 5 of the project, which has not been reached, so until then every step here is manual, and the guide will change when that automation exists. The hosting design is specified in `docs/requirements.md` §10 and the release layout in `docs/data-contract.md` §6, which are background reading and are not needed to follow the steps.

The guide follows the Cloudflare documentation as of October 2026. Menu names and limits change, so confirm each step against the current documentation (https://developers.cloudflare.com/pages/, https://developers.cloudflare.com/r2/ and https://developers.cloudflare.com/cloudflare-one/) when you run it. Dashboard paths that could not be confirmed are marked "(names may differ in the current dashboard)".

## What an instance is

A release is a directory of Parquet and JSON files with a `manifest.json` that lists them, built by `catalejo release build` and identified by its `release_id`. An instance is the application as one group of readers sees it, serving one release, and it is made of four parts.

- A Cloudflare Pages project, which serves the static application at `<project>.pages.dev` together with two Pages Functions, small programs that Cloudflare runs on requests to given paths. The Function at `/data/` reads the release files, and the Function at `/assets/` reads the files of DuckDB-WASM, the database engine that the application runs in the browser to read Parquet files, and of its extensions.
- An R2 bucket, Cloudflare's object storage, which holds the releases and the engine files. Both Functions read it through a binding, a named link set in the project's settings, called `RELEASES`, so the application itself holds no credentials.
- A pointer file in the bucket, a small JSON file of the form `{"release_id":"synth"}` that names the release the instance serves. Publishing a release means copying it to the bucket and then rewriting the pointer.
- A Cloudflare Access policy, which asks every visitor to log in and admits only the listed email addresses.

The main instance serves the full collection, with the pointer `releases/current.json`. A group instance serves the release of one access group, a named subset of the collection that one collaborating group may see, listed in the tables `groups.csv` and `genome_groups.csv` (`docs/data-contract.md` §4.8). It has its own Pages project and the pointer `releases/<group_id>/current.json`, and it shares the bucket and the engine files with the main instance. In the bucket, a release lives under `releases/<release_id>/`, the release of a group under `releases/<release_id>/<group_id>/`, the engine files under `assets/duckdb-wasm/<version>/` and the extensions under `assets/duckdb-extensions/`.

## How to use this guide

The first time, do Part 1, steps 1 to 7, then Part 2. After that, open Part 3 when a routine task comes up, and Part 4 when something fails.

- Part 1 is the one-time setup of the account and of the main instance. Steps 6 and 7 set up one instance, and they come back only through Part 3, task 3, which adds a group instance and skips items 5 and 6 of step 7, since those are done once per account.
- Part 2 is the first deployment. It puts the synthetic release, generated data that holds no real genomes, on the main instance, so that the whole chain can be checked before any real data goes up.
- Part 3 holds the routine tasks, which are publishing a new data release, deploying a new version of the application, adding a group instance and rotating credentials.
- Part 4 lists the failure states, their causes and fixes, and the limits of the free plans.

The commands of Part 1, step 1 that come before `cd catalejo` run in the directory where you want the clone, for example `~/src`. Every command after it runs from the repository root, unless the text before its block says otherwise.

Credentials live in a file named `.env` (Part 1, step 2). A step that needs them says "with `.env` loaded (Part 1, step 2)", which means that the terminal has run the two commands at the end of that step since it was opened. Load `.env` only in the terminal you use for rclone and wrangler, and install and build in another terminal where it is not loaded, so that the install scripts of packages do not see the credentials. The guide calls these the credentials terminal and the build terminal.

The following placeholders appear throughout. Replace each one, angle brackets included, with your own value.

| Placeholder | Meaning | Example |
|---|---|---|
| `<account_id>` | the Cloudflare account ID, 32 hexadecimal characters (Part 1, step 3) | `0123456789abcdef0123456789abcdef`, made up |
| `<team>` | the Zero Trust team name, which gives the login domain `<team>.cloudflareaccess.com` (Part 1, step 3) | `my-lab` |
| `<project>` | the name of the Pages project of an instance, which gives its hostname `<project>.pages.dev` | `catalejo-main`, an example name for the main instance |
| `<release_id>` | the identifier of a release, `YYYY-MM` with an optional letter, or `synth` | `synth` |
| `<old_release_id>` | an earlier release to remove from the bucket (Part 3, task 1) | `2026-09` |
| `<group_id>` | the identifier of an access group, as in `groups.csv` | `core`, one of the synthetic groups |
| `<catalog>` | the path of the master catalog file, whose stem is the `release_id` | `data/catalog/synth.duckdb` |
| `<tables>` | the directory that holds `groups.csv` and `genome_groups.csv` (Part 3, task 3) | `data/synth` |
| `<repository>` | the absolute path of your clone, as printed by commands that show full paths | `/home/me/src/catalejo` |
| `<hash>` | the identifier of one deployment, in its own address `https://<hash>.<project>.pages.dev` | `1a2b3c4d` |
| `<version>` | the version of the DuckDB-WASM package, pinned in `config/versions.yaml` | `1.32.0` |
| `<engine>` | the DuckDB engine version of the extensions, pinned in the same file | `1.4.3`, in directories named `v1.4.3` |
| `<id>` | a genome identifier | `KPN0001` |
| `<etag>` | the ETag header of an earlier answer, copied from that answer (Part 2, step 6) | |

The bucket is named `catalejo-releases` and the rclone remote is named `r2` in every command. A remote is a named connection stored in rclone's own configuration file, created in Part 1, step 4. If you choose other names, replace them in every command, and set `CATALEJO_R2_BUCKET` and `CATALEJO_R2_REMOTE` in `.env`. Those two variables are read from the environment by `upload-assets`, the pnpm script of the web package that uploads the engine files (Part 2, step 2), so they take effect in a terminal where `.env` is loaded, and without them it uses `r2` and `catalejo-releases`. The line `R2_BUCKET` of `.env` is reserved for the release workflow of milestone 5 and is read by nothing yet.

## Part 1. One-time setup

### Step 1. Tools and the repository

The guide needs git, uv, Node 24, pnpm and rclone. uv runs the `catalejo` command, Node and pnpm build the application, and rclone copies releases and engine files to the bucket. wrangler, the Cloudflare command line tool, needs no installation, since every wrangler command here is written `npx wrangler@4 ...` and npx downloads wrangler 4 on first use. The commands below are for macOS with Homebrew (https://brew.sh), which also provides git through the Xcode command line tools. `docs/setup.md` §1 gives more detail, including the Linux equivalents.

```
brew install uv fnm rclone
```

fnm installs Node and switches to the version named in the repository's `.node-version` whenever a terminal enters the repository. For that, add its line to `~/.zshrc`, then open a new terminal. With bash, write `--shell bash` and `~/.bashrc` instead.

```
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc
```

In the new terminal, install Node 24 and enable pnpm through corepack, which ships with Node.

```
fnm install 24
```

```
corepack enable pnpm
```

In the directory where you want the clone, for example `~/src`, clone the repository and enter it. Every later command runs from this directory.

```
git clone https://github.com/microbialds/catalejo.git
```

```
cd catalejo
```

Check the tools. The first command prints `v24` followed by a minor version, the second prints `10.10.0`, the version pinned in `packages/web/package.json`, and the last two print their versions. A "command not found" error means the tool is not installed or not on the `PATH`, and a different Node version means the fnm line is missing from the shell configuration.

```
node --version
```

```
(cd packages/web && pnpm --version)
```

```
uv --version
```

```
rclone version
```

Install the ingestion package, which provides the `catalejo` command. uv installs Python 3.13 on first use. The first command ends without an error, and the second, which is the check, prints the usage of `catalejo` and its list of commands.

```
uv sync --project packages/ingest
```

```
uv run --project packages/ingest catalejo --help
```

The `catalejo` command runs through uv as `uv run --project packages/ingest catalejo ...`, which is how every command in this guide is written. For a shorter form in an interactive terminal, the following line defines a shell function in zsh or bash, so that `catalejo` runs the command through uv for as long as the terminal stays open.

```
catalejo() { uv run --project packages/ingest catalejo "$@"; }
```

### Step 2. The credentials file

The credentials live in `.env` at the repository root, which git ignores. Create it from the example. `-n` never overwrites an existing file, so running this step again cannot erase a `.env` you have already filled in.

```
cp -n .env.example .env
```

Make it readable only by you.

```
chmod 600 .env
```

None of the values can be filled in yet. `CLOUDFLARE_ACCOUNT_ID` comes from step 3, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` from step 4, and `CLOUDFLARE_API_TOKEN` from step 5, while `R2_BUCKET` is already set. Each line reads `KEY=value` with no spaces around the equals sign, and a value that contains spaces, `#`, `$`, `!` or backticks goes between single quotes. The comment lines of the example stay as they are. Once steps 3 to 5 are done, the value lines read as follows, here with made-up values.

```
CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef
CLOUDFLARE_API_TOKEN=example-api-token-from-step-5
R2_BUCKET=catalejo-releases
R2_ACCESS_KEY_ID=example-access-key-id-from-step-4
R2_SECRET_ACCESS_KEY=example-secret-access-key-from-step-4
```

Keep a copy of the values in a password manager. A shell does not read `.env` by itself, so load it in the credentials terminal before running a command that needs the credentials, again in every new terminal, and again after editing the file.

```
set -a; source ./.env; set +a
```

Then check that the values the later steps need are set.

```
: "${CLOUDFLARE_ACCOUNT_ID:?not set}" "${R2_ACCESS_KEY_ID:?not set}" "${R2_SECRET_ACCESS_KEY:?not set}"
```

The check prints nothing when all three values are set, and otherwise stops with the name of the first one missing, for example `R2_ACCESS_KEY_ID: not set`. Until step 4 is done it is expected to stop. From here on, "with `.env` loaded (Part 1, step 2)" means that both commands have run in the current terminal and the check printed nothing.

### Step 3. Cloudflare account, billing alert and Zero Trust team

1. Create a Cloudflare account with the address that will own the instances, and enable two-factor authentication.
2. Once you are logged in, the address bar of the dashboard reads `https://dash.cloudflare.com/` followed by a string of 32 hexadecimal characters, which is the Account ID. The R2 overview page also shows it. Put it in `.env` as `CLOUDFLARE_ACCOUNT_ID`. It is `<account_id>` in the rest of the guide.
3. Add a payment method under Manage Account, Billing, even if everything stays on free plans, so that the paid Workers plan can be enabled in one click if the Functions quota is reached (Part 4). Then add a billing usage notification under Notifications, Add, with a threshold such as USD 5 (names may differ in the current dashboard).
4. Open Zero Trust from the left navigation, choose a team name and select the free plan. The team name is `<team>` in the rest of the guide, and the login page of every instance in the account is served at `<team>.cloudflareaccess.com`. Record the team name in the password manager, since Part 2 needs it.

### Step 4. R2 bucket, its token and the rclone remote

1. Open R2 from the left navigation. The first time, R2 may ask to be activated, which requires the payment method of step 3 even though use stays within the free tier. Select Create bucket, name it `catalejo-releases` and leave the location on automatic. Leave public access off, since the bucket is reached only through the Pages Functions.
2. In R2, open Manage R2 API tokens and create an Account API token, so that it does not depend on one user's login, with the permission Object Read & Write applied to the bucket `catalejo-releases` only, and a TTL of Forever or a long period (names may differ in the current dashboard). Part 3, task 4 explains how to replace it. The page that follows shows a token value, an Access Key ID, a Secret Access Key and the S3 endpoint. Copy the Access Key ID into `.env` as `R2_ACCESS_KEY_ID` and the Secret Access Key as `R2_SECRET_ACCESS_KEY`. The secret is shown only once, so copy it before leaving the page, and if it is lost, delete the token and create a new one. The token value is neither an rclone key nor the API token of step 5, and nothing in this guide uses it. Pasting it in place of either key is the most common cause of a failing remote. The endpoint shown must read `https://<account_id>.r2.cloudflarestorage.com`, with the same account ID as `.env`.
3. In the credentials terminal, with `.env` loaded (Part 1, step 2) and the check now printing nothing, create the rclone remote. First list the remotes that already exist.

```
rclone listremotes
```

It prints one remote name per line, each followed by a colon, such as `r2:`, or nothing when there are none. If a remote named `r2` exists and serves something else, pick another name for this one, use it in place of `r2` in every rclone command of this guide, and set `CATALEJO_R2_REMOTE` to it in `.env`. Otherwise delete any existing `r2`, since a remote created in a terminal where `.env` was not loaded holds empty values. Deleting a remote that does not exist does nothing.

```
rclone config delete r2
```

```
rclone config create r2 s3 provider=Cloudflare access_key_id="$R2_ACCESS_KEY_ID" secret_access_key="$R2_SECRET_ACCESS_KEY" endpoint="https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" acl=private no_check_bucket=true >/dev/null
```

The values are quoted so that the shell passes each one whole. `no_check_bucket=true` stops rclone from trying to create the bucket before an upload, which a token limited to one bucket is not allowed to do. The command would print the new section of the configuration, secret included, so its output is sent to `/dev/null`. Check the three settings that matter.

```
rclone config show r2 | grep -E '^(endpoint|no_check_bucket|provider)'
```

It prints the following three lines, with your account ID in the endpoint.

```
no_check_bucket = true
provider = Cloudflare
endpoint = https://<account_id>.r2.cloudflarestorage.com
```

An endpoint of `https://.r2.cloudflarestorage.com` means that `.env` was not loaded, and the remote must be deleted and created again. rclone keeps the remote in its own configuration file, whose path `rclone config file` prints, usually `~/.config/rclone/rclone.conf`. The keys are stored there in plain text, so keep that file private, and note that the rclone commands of this guide work without `.env` once the remote exists.

4. Check the remote by writing a small file, reading it back, deleting it and counting what the bucket holds.

```
echo ok | rclone rcat r2:catalejo-releases/healthcheck.txt
```

```
rclone cat r2:catalejo-releases/healthcheck.txt
```

```
rclone deletefile r2:catalejo-releases/healthcheck.txt
```

```
rclone size r2:catalejo-releases
```

The first and third commands print nothing, the second prints `ok`, and the last prints the number of objects and their total size, with `Total objects: 0` on a new bucket. Listing commands are not a useful check with this token. `rclone lsd r2:` lists buckets, which a token limited to one bucket may not do, so it is expected to fail, and `rclone lsd r2:catalejo-releases` prints nothing on an empty bucket whether or not the credentials work.

Typical errors and their meaning follow.

| Message contains | Meaning |
|---|---|
| `SignatureDoesNotMatch` | the secret is wrong or empty; load `.env`, then delete and create the remote again |
| `InvalidAccessKeyId` or "does not exist" | the Access Key ID is wrong, or the token value was copied in its place |
| `AccessDenied` on `rcat` | the token is read-only or applies to another bucket, or the remote lacks `no_check_bucket = true`; on `rclone lsd r2:` it is expected |
| `NoSuchBucket` | the bucket name is misspelled in the command or the bucket does not exist |
| `no such host` or `dial tcp` | the endpoint is wrong, usually because the account ID was empty when the remote was created |
| `didn't find section in config file` | there is no remote named `r2`; create it as above |

### Step 5. API token for wrangler

wrangler needs to act on the account, either through an API token or through a login in the browser. The first `npx wrangler@4` command asks whether to install the wrangler package, and the answer is `y`.

1. To use a token, open My Profile, API Tokens, Create Token, Custom token (names may differ in the current dashboard). Give it the permission Account, Cloudflare Pages, Edit, limited to this account, and a name that says what it is for, such as `catalejo-ci`. That permission is enough for the deployments of this guide, since uploads to the bucket go through rclone with the R2 token. The release and deploy workflows of milestone 5 will also need Account, Workers R2 Storage, Edit, so add it now if the same token is to be stored on GitHub later, or edit the token then. Put the token's value in `.env` as `CLOUDFLARE_API_TOKEN`. With `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` loaded, wrangler uses them without a login.
2. To log in instead, remove the `CLOUDFLARE_API_TOKEN` line from `.env`, or put `#` at its start, so that wrangler uses the login. Then load `.env` again and run the following once. It opens the browser and asks you to allow wrangler access to the account.

```
npx wrangler@4 login
```

Either way, with `.env` loaded (Part 1, step 2), check which account wrangler will act on before using it.

```
npx wrangler@4 whoami
```

It prints `Getting User settings...`, a line saying whether you are logged in with an API token or an OAuth token, and a table with the columns Account Name and Account ID. The Account ID in that table must be the one in `.env`. A token without permission to read user details may add a warning that the email cannot be read, which does no harm as long as the account ID appears. When wrangler is not authenticated it prints ``You are not authenticated. Please run `wrangler login`.``, which means that the token is missing from `.env`, `.env` was not loaded in this terminal, or the login has not been done.

### Step 6. Pages project, once per instance

Each instance has its own Pages project. Project names allow lowercase letters, digits and hyphens. In this guide the main instance's project is called `catalejo-main` where an example helps, and a group instance's `catalejo-<group_id>`, but any name works.

1. With `.env` loaded (Part 1, step 2), create the project from the terminal, with the production branch set to `main`.

```
npx wrangler@4 pages project create <project> --production-branch main
```

On success wrangler prints a line like `Successfully created the '<project>' project. It will be available at https://<project>.pages.dev/ once you create your first deployment.` The project name is what `--project-name` takes in every later command. The hostname is whatever wrangler reports, because `pages.dev` names are shared by all Cloudflare accounts, and when another account already holds the name Cloudflare adds a suffix. Use the reported hostname wherever this guide writes `<project>.pages.dev`. An error naming an existing project means the name is already used in this account.

Do not connect the GitHub repository to the project. A project connected to Git builds on every push, while Catalejo deploys by hand until milestone 5 and from a workflow on tags afterwards. A project created from the terminal is a direct-upload project and has no build settings, so there is nothing to configure under Builds.

2. Add the R2 binding. In Workers & Pages, open the project, then Settings, Bindings, Add, R2 bucket (names may differ in the current dashboard), and add the variable name `RELEASES` bound to the bucket `catalejo-releases`, once for the Production environment and once for Preview. The Function in `packages/web/functions/data/[[path]].ts` reads releases through this binding, and `packages/web/functions/assets/[[path]].ts` reads the engine files through it.
3. Set the group, for a group instance only. The main instance has no `CATALEJO_GROUP` variable, and none should be created, since an unset variable is what marks the main instance. A group instance sets `CATALEJO_GROUP` to its `<group_id>` under Settings, Variables and Secrets (names may differ in the current dashboard), for Production and Preview. Any value that is not a valid group identifier, even a single space, makes every `/data/` request answer 503, so a misconfigured instance fails closed.
4. Bindings and variables apply only to deployments made after they are saved. During the first setup, do not deploy at this point, since the instance is not yet protected. The first deployment of the application is Part 2, step 5, after step 7. Later, after changing a binding or a variable on a running instance, deploy again as in Part 3, task 2.

### Step 7. Access policy, once per instance

An Access application is Cloudflare's record of a protected hostname, together with the policy that says who may open it. The "Enable access policy" setting of a Pages project creates one that protects only the preview deployments, and leaves `<project>.pages.dev` open. The procedure below, taken from the Pages known issues in the Cloudflare documentation, extends the protection to the production hostname and leaves two Access applications per project.

1. In Workers & Pages, open the project, then Settings, and select Enable access policy (names may differ in the current dashboard). This creates an Access application for the preview deployments.
2. Select Manage on the Access policy just created. In the application's subdomain field, delete the wildcard `*` and save. The application now covers `<project>.pages.dev`. Back in the project's Settings, the access policy setting shows as not enabled again, since the preview deployments are no longer covered.
3. Select Enable access policy again, so that the previews get an application of their own.
4. Zero Trust, Access, Applications (names may differ in the current dashboard) now lists two applications for the project, one for `<project>.pages.dev` and one for the previews. In each, edit the application's own policy, and do not attach one reusable policy to the applications of two instances, since a change to a shared policy changes who can open both. Set the action to Allow, and include Emails with the addresses of the instance's readers, or Emails ending in an institutional domain if a whole institution should have access. Never include Everyone, and never a public email domain such as `gmail.com`, which would admit anyone with an address there. For the first deployment, list your own address and a second one you can test with. In the settings of each application, set the session duration to 24 hours (names may differ in the current dashboard).
5. Add a login method under Zero Trust, Settings, Authentication, Login methods (names may differ in the current dashboard). One-time PIN sends a code to any address the policy allows, and other providers such as Google can be added later. This is done once per account.
6. Under Zero Trust, Settings, Custom pages (names may differ in the current dashboard), set the application name of the login page to Catalejo, so that the page reads as the platform's. This is also done once per account.
7. The free Zero Trust plan covers up to 50 users across all applications in the account, and each person who logs in takes one. Watch the count under Zero Trust, My Team, Users (names may differ in the current dashboard) as instances are added.
8. Check the protection before anything real is deployed. A project with no deployment may serve nothing at all, so deploy a placeholder first, a single page that holds no data and uses no Functions, which makes the check safe. In the credentials terminal, create its directory and page.

```
mkdir -p ~/catalejo-placeholder
```

```
echo '<p>This instance is being set up.</p>' > ~/catalejo-placeholder/index.html
```

With `.env` loaded (Part 1, step 2), deploy it from that directory, in a subshell, so that the terminal stays at the repository root.

```
(cd ~/catalejo-placeholder && npx wrangler@4 pages deploy . --project-name <project> --branch main)
```

wrangler ends by naming the address of this deployment, `https://<hash>.<project>.pages.dev`. Open `https://<project>.pages.dev` in a private window and confirm that it redirects to `<team>.cloudflareaccess.com`, then do the same with the address of the deployment. If either address shows the placeholder page without asking for a login, that hostname is not protected, and nothing else should be deployed until it is. Part 2 replaces the placeholder, and its directory can then be removed.

```
rm -r ~/catalejo-placeholder
```

## Part 2. First deployment with the synthetic release

The first deployment puts the synthetic release, 100 generated genomes that hold no real data, on the main instance, so that every link from the bucket to the browser can be checked before a real release goes up. It assumes that Part 1 is complete for the main instance, including the redirect check of step 7. In this part `<project>` is the main instance's project and `<release_id>` is `synth`.

Deploying from a branch other than `main` is possible, because the deploy command of step 5 makes the deployment the production one whatever branch git is on.

### Step 1. Build the application

In the build terminal, where `.env` is not loaded, install the web dependencies.

```
pnpm --dir packages/web install --frozen-lockfile
```

It installs the exact versions recorded in `packages/web/pnpm-lock.yaml` and ends with a line that starts with `Done in`. It fails with `ERR_PNPM_OUTDATED_LOCKFILE` if the lockfile does not match `packages/web/package.json`. Then build.

```
pnpm --dir packages/web build
```

The build ends with `check-dist`, which refuses a `dist` directory that holds engine files, a file over 25 MiB, a host outside the allowed list, or no `_routes.json`. On success it prints two lines like the following, where the file count and the size depend on the build.

```
check-dist: ok; 7 files; largest 0.39 MiB
check-dist: hosts named in the bundle: fonts.googleapis.com, fonts.gstatic.com, github.com, react.dev, tailwindcss.com, www.w3.org
```

On failure it prints `check-dist: failed` followed by one line per problem, and the build exits with an error.

### Step 2. Upload the engine and its extensions

The DuckDB-WASM engine files are larger than the 25 MiB per file that Pages accepts, and the extensions would otherwise be fetched from the internet, so both are served from the bucket through the Function at `/assets/`. Until milestone 5 they are uploaded by hand. Run this step in the credentials terminal, which is where `CATALEJO_R2_REMOTE` and `CATALEJO_R2_BUCKET` take effect if you set them. The first command fills `packages/web/.cache/duckdb-extensions` and checks each file against its hash in `config/versions.yaml`.

```
pnpm --dir packages/web run extensions
```

It ends with a line such as `fetch-duckdb-extensions: 4 files in .cache/duckdb-extensions (0 downloaded)`, where the number downloaded is 4 on the first run and 0 once the files are in place. If a download does not match its pinned hash, it prints `fetch-duckdb-extensions: failed` with the file concerned and exits with an error. The dry run then lists the uploads without running them, and needs no rclone.

```
pnpm --dir packages/web run upload-assets -- --dry-run
```

It prints eight `rclone copyto --checksum` lines, four for the engine files and four for the extensions, and a summary line. The local paths start at `<repository>`, and the version in them is the one pinned at the time of writing, so the first and last lines read as follows.

```
rclone copyto --checksum <repository>/packages/web/node_modules/.pnpm/@duckdb+duckdb-wasm@1.32.0/node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm r2:catalejo-releases/assets/duckdb-wasm/1.32.0/duckdb-mvp.wasm
upload-assets: dry run, 8 files, nothing uploaded
```

If a file is missing, it lists the missing files and asks you to install the dependencies or fetch the extensions. Run `pnpm --dir packages/web install --frozen-lockfile` in the build terminal for the engine, or `pnpm --dir packages/web run extensions` for the extensions, and try again. The upload runs the same eight commands.

```
pnpm --dir packages/web run upload-assets
```

It ends with `upload-assets: 8 files in r2:catalejo-releases/assets/`. A file already in the bucket with the same checksum is not sent again, so the command can be repeated safely. If rclone fails, the script stops at the file concerned and names it, and the table of Part 1, step 4 explains the rclone message printed above it. To see what the bucket holds, list the prefix.

```
rclone ls r2:catalejo-releases/assets/
```

The listing shows eight files, each preceded by its size, namely the four engine files under `duckdb-wasm/<version>/` (`duckdb-mvp.wasm`, `duckdb-browser-mvp.worker.js`, `duckdb-eh.wasm` and `duckdb-browser-eh.worker.js`) and the `parquet` and `json` extensions under `duckdb-extensions/v<engine>/wasm_mvp/` and `duckdb-extensions/v<engine>/wasm_eh/`.

### Step 3. Build and check the synthetic release

This step runs in the build terminal. On a fresh clone, go straight to the build below. If `releases/synth` already exists from local development, check instead that it is the current build of the synthetic catalog, which the following command does by comparing every file with the checksums in the manifest.

```
uv run --project packages/ingest catalejo release check --catalog data/catalog/synth.duckdb --release releases/synth
```

It prints one `warning:` line per warning, which are expected on the synthetic data, and ends with the following line.

```
catalejo release check: checked catalog, release releases/synth: 0 failures, 28 warnings
```

When it passes, go on to step 4. When it reports failures, or the catalog or the release is missing, build the release with the following sequence, which is the one in `packages/ingest/README.md` and in CI. It runs as one subshell with `set -e`, so that it stops at the first command that fails, and its first line defines the shell function of Part 1, step 1 for the subshell only.

```
(
  set -e
  catalejo() { uv run --project packages/ingest catalejo "$@"; }
  catalejo synth --species 10 --genomes 100 --out data/synth
  catalejo metadata init --mgap data/synth/results --existing data/synth/metadata.csv --out data/synth/metadata.csv
  catalejo ingest --mgap data/synth/results --metadata data/synth/metadata.csv --catalog data/catalog/synth.duckdb
  catalejo tombstones ingest --file data/synth/tombstones.csv --catalog data/catalog/synth.duckdb
  catalejo groups ingest --groups data/synth/groups.csv --members data/synth/genome_groups.csv --catalog data/catalog/synth.duckdb
  catalejo sets ingest --file data/synth/sets.csv --catalog data/catalog/synth.duckdb
  catalejo release check --catalog data/catalog/synth.duckdb --metadata data/synth/metadata.csv --mgap data/synth/results
  catalejo release build --catalog data/catalog/synth.duckdb --out releases/synth
  catalejo release check --catalog data/catalog/synth.duckdb --release releases/synth
)
```

The sequence takes under a minute, and each command prints what it did. The first check, on the catalog and its inputs, ends with `catalejo release check: checked catalog, metadata and mgap results: 0 failures, 28 warnings`, and the last one ends with the line given above. A command that fails prints its failures and stops the sequence with an error, and the failure must be understood before the sequence is run again.

### Step 4. Publish the release and write the pointer

The remaining steps run in the credentials terminal. `rclone sync` makes the destination match the source, so it deletes from the bucket anything under the destination path that the local directory lacks. A mistyped destination, such as `r2:catalejo-releases/releases` without the release identifier, would delete the pointers and every other release, so run the sync with `--dry-run` first and read what it would do.

```
rclone sync releases/synth r2:catalejo-releases/releases/synth --checksum --dry-run
```

It changes nothing, and prints one line per file it would copy, each ending in `Skipped copy as --dry-run is set` with the file's size, followed by a summary. On a first publication there must be no line with `Skipped delete`. Then copy the release, with `-P` showing the progress.

```
rclone sync releases/synth r2:catalejo-releases/releases/synth --checksum -P
```

It ends with a summary of the files transferred and no error, and otherwise prints an rclone error from the table of Part 1, step 4. Compare the bucket with the local directory.

```
rclone check releases/synth r2:catalejo-releases/releases/synth
```

It reports `0 differences found` and the number of matching files, and otherwise names each file that differs. The group releases `core` and `amr-network` inside `releases/synth` are copied with it, and the main instance ignores them. Then write the pointer of the main instance, which names the release it serves.

```
echo '{"release_id":"synth"}' | rclone rcat r2:catalejo-releases/releases/current.json
```

Read the pointer back.

```
rclone cat r2:catalejo-releases/releases/current.json
```

It prints `{"release_id":"synth"}`. The release is copied before the pointer is written, so that the pointer never names a release that is not complete in the bucket.

### Step 5. Deploy

With `.env` loaded (Part 1, step 2), check the authentication if the terminal is new.

```
npx wrangler@4 whoami
```

Then deploy from `packages/web`, inside a subshell, so that the terminal stays at the repository root.

```
(cd packages/web && npx wrangler@4 pages deploy dist --project-name <project> --branch main --commit-dirty=true)
```

The deploy runs in `packages/web` because wrangler compiles the Functions from the `functions/` directory of its working directory. Started at the repository root, it would upload the static files without the `/data/` and `/assets/` Functions, and every data request would then return the application page. `--branch main` makes this a production deployment whatever branch git is on, since a deployment from any other branch becomes a preview, and `--commit-dirty=true` silences the warning about uncommitted files.

The exact wording of wrangler's output has not been checked against a real deployment. It reports that it compiled the Functions, how many files it uploaded, and that it uploaded `_routes.json` and the Functions bundle, and it ends with a line saying the deployment is complete. Until the output is confirmed, success means that the command exits without an error and that its last lines name an address of the form `https://<hash>.<project>.pages.dev`. That address belongs to this one deployment, while the production address `https://<project>.pages.dev` serves the newest production deployment, which replaces the placeholder of Part 1, step 7.

### Step 6. Check from a private window

Use a private window of a browser other than the one you are logged in to the Cloudflare dashboard with.

1. Open the address of the deployment, `https://<hash>.<project>.pages.dev`, and confirm that it redirects to `<team>.cloudflareaccess.com`.
2. Open `https://<project>.pages.dev`, which redirects to the Access login at `<team>.cloudflareaccess.com`, and back to `<project>.pages.dev` after the one-time PIN. The Collection page loads with 100 genomes in the current set, which is the bar at the top of the page counting the genomes that the active filters select, all of them when there is no filter. The footer of the left column reads Release synth.
3. In the network panel of the developer tools, every request goes to `<project>.pages.dev`, to the login domain while logging in, or to Google Fonts. `/data/manifest.json` answers with `cache-control: no-cache`, a read of a `/data/r/synth/...parquet` file answers 206 with `cache-control: public, max-age=31536000, immutable`, and `/assets/duckdb-wasm/...` answers 200, or comes from the browser cache on a second visit.
4. Add a filter with the "+ add filter" link in the bar at the top, which sits behind the Set control in windows narrower than 1,200 pixels, then reload, and the set is the same. Type a genome identifier in the search field of the same bar, which moves to the top of the Menu in windows narrower than 900 pixels, and choose it. It opens `/genomes/<id>`, which shows a placeholder, since the Genome page arrives in a later version.
5. The Functions logs show no errors. Follow them from the credentials terminal, with `.env` loaded (Part 1, step 2), while you use the page.

```
npx wrangler@4 pages deployment tail --project-name <project>
```

It streams one entry per Function request until you stop it with Ctrl+C. Optionally, the same logs are in the dashboard under the project, Functions, Real-time logs (names may differ in the current dashboard). If a check fails, Part 4 lists what each symptom means.

Optionally, confirm that R2 answers range and conditional requests as its documentation states. The Function does not depend on this, but the check shows the whole path working. It uses your Access cookie, which admits whoever holds it, so do not run it on a shared machine. Copy the value of the `CF_Authorization` cookie for `<project>.pages.dev` from the developer tools (Application, Cookies in Chrome; Storage, Cookies in Firefox), and read it into a variable without echoing it, so that it does not enter the shell history.

```
read -rs CF_AUTH
```

Paste the value and press Enter. A plain request then gives the size and the ETag.

```
curl -s -o /dev/null -D - -H "cookie: CF_Authorization=$CF_AUTH" https://<project>.pages.dev/data/r/synth/presence_amr.parquet
```

It answers 200 with `content-length` and `etag` headers. On the synthetic build at the time of writing the length is 4456, which the following answers assume, and a different length shifts their numbers. A range that starts past the end answers 416 with `content-range: bytes */4456`.

```
curl -s -o /dev/null -D - -H "cookie: CF_Authorization=$CF_AUTH" -H "Range: bytes=9999999-" https://<project>.pages.dev/data/r/synth/presence_amr.parquet
```

A suffix range answers 206 with the last four bytes, `content-range: bytes 4452-4455/4456`.

```
curl -s -o /dev/null -D - -H "cookie: CF_Authorization=$CF_AUTH" -H "Range: bytes=-4" https://<project>.pages.dev/data/r/synth/presence_amr.parquet
```

A conditional request with the ETag of the first answer, copied with its double quotes in place of `"<etag>"`, answers 304.

```
curl -s -o /dev/null -D - -H "cookie: CF_Authorization=$CF_AUTH" -H 'If-None-Match: "<etag>"' https://<project>.pages.dev/data/r/synth/presence_amr.parquet
```

If an answer is a 302 to the login domain, the cookie is missing or expired. Close the terminal afterwards, or clear the variable, since the cookie grants access until the Access session ends.

```
unset CF_AUTH
```

## Part 3. Routine tasks

### Task 1. Publish a new data release

1. In the build terminal, build the release from mgap results as `packages/ingest/README.md` describes under "Metadata, catalog and releases". The sequence is the one of Part 2, step 3, run on real mgap results and metadata. It produces the master catalog `<catalog>` and the release directory `releases/<release_id>/`, which holds `manifest.json`, the Parquet tables, the summaries and the per-genome files, with the release of each group built with `--group` under `releases/<release_id>/<group_id>/`.
2. Check the release against its manifest.

```
uv run --project packages/ingest catalejo release check --catalog <catalog> --release releases/<release_id>
```

It ends with a line giving `0 failures` and the number of warnings. Any failure stops the procedure here, since a release that fails the check must not be published.

3. In the credentials terminal, compare the local directory with what the bucket already holds for this release. A new `release_id` has nothing in the bucket yet, and the listing is empty.

```
rclone lsf r2:catalejo-releases/releases/<release_id>/
```

`rclone sync` deletes from the bucket what the local directory lacks, so the local `releases/<release_id>/` must contain every group subdirectory that the listing shows. A group release that was built on another machine and is missing locally goes up only with the group sync of Task 3, step 3, which touches only its own prefix. Run the sync with `--dry-run` first, and check that it lists no `Skipped delete` line you did not expect.

```
rclone sync releases/<release_id> r2:catalejo-releases/releases/<release_id> --checksum --dry-run
```

```
rclone sync releases/<release_id> r2:catalejo-releases/releases/<release_id> --checksum -P
```

```
rclone check releases/<release_id> r2:catalejo-releases/releases/<release_id>
```

The sync ends with a summary and no error, and the check reports `0 differences found`, as in Part 2, step 4.

4. Write the pointer of the main instance, which switches the instance to the new release, and read it back.

```
echo '{"release_id":"<release_id>"}' | rclone rcat r2:catalejo-releases/releases/current.json
```

```
rclone cat r2:catalejo-releases/releases/current.json
```

The second command prints the pointer with the new `release_id`. The Function keeps the pointer for up to 60 seconds, so the new release appears within a minute. A reader whose page still holds the previous manifest is asked to reload, since the Function refuses files of a release that is no longer current.

5. Each group instance keeps its own pointer, so it stays on its release until its group release is built and its pointer written, as steps 2 to 4 of Task 3 describe.
6. An earlier release can be deleted from the bucket once no pointer names it, which keeps the storage within the free tier (Part 4). List every pointer, then read each one.

```
rclone lsf -R --files-only --include current.json r2:catalejo-releases/releases
```

It prints `current.json` for the main instance and `<group_id>/current.json` for each group instance.

```
rclone cat r2:catalejo-releases/releases/current.json
```

```
rclone cat r2:catalejo-releases/releases/<group_id>/current.json
```

If no pointer names `<old_release_id>`, delete it, first with `--dry-run`, which lists what would be deleted and changes nothing. Check that every line of the dry run lies under `releases/<old_release_id>/` before running the deletion.

```
rclone purge r2:catalejo-releases/releases/<old_release_id> --dry-run
```

```
rclone purge r2:catalejo-releases/releases/<old_release_id>
```

Until milestone 5, `catalejo release publish` exists only as a placeholder that exits with code 2, and the rclone commands above do its work.

### Task 2. Deploy a new version of the application

1. Build the application in the build terminal as in Part 2, step 1.
2. If the version of `@duckdb/duckdb-wasm` or the DuckDB extensions pinned in `config/versions.yaml` changed since the last deployment, upload the engine and extensions as in Part 2, step 2, before deploying, so that the new build never points at files missing from the bucket. Running `upload-assets` when nothing changed is harmless, since files with the same checksum are not sent again.
3. With `.env` loaded (Part 1, step 2), deploy to each instance's project as in Part 2, step 5, and check it from a private window as in Part 2, step 6.

```
(cd packages/web && npx wrangler@4 pages deploy dist --project-name <project> --branch main --commit-dirty=true)
```

Application versions are recorded as tags of the form `web-vX.Y.Z` on the deployed commit, created by the maintainer. Pushing such a tag runs `.github/workflows/deploy.yml`, which until milestone 5 is a skeleton that prints one line, so the tag records the version and deploys nothing by itself.

### Task 3. Add a group instance

A group instance serves the release of one access group from `releases/<release_id>/<group_id>/`, with its own pointer `releases/<group_id>/current.json`, its own Pages project and its own Access policy. The full release in the bucket is not uploaded again, since a group build writes only its own subdirectory, and the engine files under `assets/` are shared by every instance. In this task `<release_id>` is the release the main instance serves, which the main pointer names.

```
rclone cat r2:catalejo-releases/releases/current.json
```

1. Add the group to `<tables>/groups.csv` and its genomes to `<tables>/genome_groups.csv` (`docs/data-contract.md` §4.8), then, in the build terminal, ingest the two tables into the catalog and check it.

```
uv run --project packages/ingest catalejo groups ingest --groups <tables>/groups.csv --members <tables>/genome_groups.csv --catalog <catalog>
```

```
uv run --project packages/ingest catalejo release check --catalog <catalog>
```

The check ends with `0 failures`. A genome listed in `genome_groups.csv` that is not in the catalog is left out with a warning.

2. Build the group release, which `release build` writes to `releases/<release_id>/<group_id>/`, and check its files against its manifest.

```
uv run --project packages/ingest catalejo release build --catalog <catalog> --out releases/<release_id> --group <group_id>
```

```
uv run --project packages/ingest catalejo release check --catalog <catalog> --release releases/<release_id>/<group_id>
```

The build prints what it wrote and refuses a catalog that fails the check, and the second command ends with `0 failures` when every file matches the group's manifest.

3. In the credentials terminal, copy the group release to the bucket, with a dry run first as in Part 2, step 4, and compare the result.

```
rclone sync releases/<release_id>/<group_id> r2:catalejo-releases/releases/<release_id>/<group_id> --checksum --dry-run
```

```
rclone sync releases/<release_id>/<group_id> r2:catalejo-releases/releases/<release_id>/<group_id> --checksum -P
```

```
rclone check releases/<release_id>/<group_id> r2:catalejo-releases/releases/<release_id>/<group_id>
```

The sync ends with a summary and no error, and the check reports `0 differences found`.

4. Write the group's pointer and read it back.

```
echo '{"release_id":"<release_id>"}' | rclone rcat r2:catalejo-releases/releases/<group_id>/current.json
```

```
rclone cat r2:catalejo-releases/releases/<group_id>/current.json
```

The second command prints `{"release_id":"<release_id>"}` with your release identifier.

5. Create the group's Pages project as in Part 1, step 6, with the binding `RELEASES` and the variable `CATALEJO_GROUP` set to `<group_id>`. A name such as `catalejo-<group_id>` works when the group identifier holds only lowercase letters, digits and hyphens, and any other identifier needs a project name of another form. In the next steps `<project>` is the project created here. Do not deploy the application yet, since the project is not protected until step 6.
6. Set up Access as in Part 1, step 7, items 1 to 4 and 8, with the addresses of the group's readers, including the placeholder deployment and the redirect check on both addresses. Items 5 and 6 were done for the account in Part 1.
7. With `.env` loaded (Part 1, step 2), deploy the current build to the new project. If `packages/web/dist` is not current, build it first in the build terminal as in Part 2, step 1. No engine upload is needed.

```
(cd packages/web && npx wrangler@4 pages deploy dist --project-name <project> --branch main --commit-dirty=true)
```

wrangler reports the deployment as in Part 2, step 5.

8. Open `https://<project>.pages.dev` from a private window, log in, and check that the footer names the release and that the Collection page counts the group's genomes only.

### Task 4. Rotate or reissue credentials

Credentials are replaced when one may have been exposed, when someone with access leaves, or when a secret was lost. In each case the new credential is created and tested before the old one is deleted, so the instances keep working throughout. The instances themselves hold no credential, since the Functions reach the bucket through the binding, so a rotation never requires a deployment.

To replace the R2 token, follow these steps.

1. Create a new R2 API token as in Part 1, step 4, item 2, and copy its Access Key ID and Secret Access Key into `.env` in place of the old values.
2. Load `.env` again in the credentials terminal (Part 1, step 2) and run the check.
3. Delete and create the rclone remote `r2` with the commands of Part 1, step 4, item 3, since the remote keeps its own copy of the old keys, and verify it with `rclone config show` as there.
4. Run the four health check commands of Part 1, step 4, item 4.
5. In R2, Manage R2 API tokens (names may differ in the current dashboard), delete the old token.

To replace the API token, create a new one as in Part 1, step 5, put it in `.env` as `CLOUDFLARE_API_TOKEN`, load `.env` again and run `npx wrangler@4 whoami`, then delete the old token under My Profile, API Tokens (names may differ in the current dashboard). If wrangler uses a browser login instead, run `npx wrangler@4 login` again.

From milestone 5 the release and deploy workflows read the same values from repository secrets on GitHub (Settings, Secrets and variables, Actions), as `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Once they exist, a rotation updates those secrets as well, before the old token is deleted.

## Part 4. Troubleshooting and limits

### Failure states

The Functions answer with a short plain-text message when they cannot serve a request. The first column quotes it, or describes what you see when there is no message.

| What you see | Cause | Fix |
|---|---|---|
| `/data/manifest.json` answers 503 with "No current release is published for this instance." | the instance's pointer, `releases/current.json` or `releases/<group_id>/current.json` for a group instance, is missing | write the pointer (Part 2, step 4, or Part 3, task 3, step 4) |
| 503 with "The current release pointer is not valid JSON." or "The current release pointer does not name a valid release." | the pointer was written with a typo, or with a `release_id` that is not a valid identifier | write the pointer again and read it back with `rclone cat` |
| 503 with "The RELEASES bucket binding is not configured for this Pages project." on `/data/` or `/assets/` | the binding is missing, or was saved after the deployment | add the binding (Part 1, step 6), then deploy again (Part 3, task 2) |
| 503 with "The CATALEJO_GROUP variable is not a valid group identifier." | `CATALEJO_GROUP` holds a value that is not a group identifier; on the main instance, any value at all | delete the variable on the main instance or correct it on a group instance, then deploy again (Part 3, task 2) |
| `/data/manifest.json` answers 404 with "Not found." | the pointer names a release that is not in the bucket under the instance's prefix | copy the release (Part 2, step 4, or Part 3, task 1) and check the `release_id` in the pointer |
| `/data/r/<release_id>/...` answers 404 with the header `X-Catalejo-Release: stale` and "This release is no longer current; reload the page." | the page was loaded before the pointer changed, and the release it asks for is no longer the current one | reload the page; this is the expected behavior after a new release is published |
| HTML where JSON or Parquet is expected | the Functions were not deployed, because the deploy ran outside `packages/web`, or `_routes.json` is missing from `dist` | build (Part 2, step 1) and deploy from `packages/web` (Part 2, step 5) |
| `/assets/duckdb-wasm/...` or `/assets/duckdb-extensions/...` answers 404 | the engine files or extensions for this build's version are not in the bucket | upload them (Part 2, step 2) |
| the placeholder page of Part 1, step 7 still shows after a deployment | the application was deployed without `--branch main` from a branch other than `main`, so it became a preview | deploy again with `--branch main` (Part 2, step 5) |
| the deployment appears under previews, and `<project>.pages.dev` still serves the earlier one | the same cause | deploy again with `--branch main` (Part 2, step 5) |
| the address loads without a login | the hostname has no Access application | Part 1, step 7 |
| an rclone command fails with `AccessDenied`, `SignatureDoesNotMatch`, `no such host` or a similar message | the remote or the token is misconfigured, for example created without `.env` loaded, which leaves the endpoint as `https://.r2.cloudflarestorage.com`, or without `no_check_bucket=true` | the table in Part 1, step 4 gives the meaning of each message; delete and create the remote again |

### The pointer cache

Each running copy of the data Function keeps the pointer it read for up to 60 seconds, so a new pointer is seen within a minute and most requests read no pointer at all. Copies refresh their pointers at different times, so a reader may get the new manifest from one copy and then ask another copy, which still holds the old pointer, for a file of the new release. The Function therefore reads the pointer once more before refusing a release that differs from the one it holds, and refuses it as stale only when the fresh pointer does not name it. A reader never sees files of two releases mixed, because every file under `/data/r/<release_id>/` belongs to one release and is cached as immutable under that path.

### Quotas

- Functions requests. The free plan allows 100,000 requests per day (confirm the current figure). DuckDB-WASM reads Parquet files in parts, and each part counts as a request, so a busy day with several readers can approach the limit. If it is exceeded, enable the paid Workers plan, which the payment method of Part 1, step 3 makes a one-click change.
- R2 storage. 10 GB are free. A release of 10,000 genomes with per-genome files takes a few gigabytes, so keep online only the releases that some pointer names (Part 3, task 1, item 6).
- Access users. The free Zero Trust plan covers 50 users across all instances in the account.

## What changes in milestone 5

Milestone 5 automates the manual parts of Part 3, as the opening of this guide notes. `catalejo release publish`, which today exits with code 2, will upload a release to the bucket, and the workflow `.github/workflows/release.yml`, started by hand with a `release_id` and an optional group, will check, build and publish the release and then update its pointer, which replaces the rclone commands of Part 3, task 1. The workflow `.github/workflows/deploy.yml`, run on a `web-vX.Y.Z` tag, will build the application, upload the engine files, check each instance's manifest against the versions the application supports and deploy to every Pages project, which replaces Part 3, task 2. Part 1 and Part 2 stay manual, and this guide will be updated when the workflows exist.
