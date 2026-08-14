<div align="center">
  <img src="apps/readest-app/public/icon.png" alt="Leaf Logo" width="120px" style="border-radius: 20%;" />
  <h1>Leaf</h1>
  <h3>The Ebook Reader for Biblophile</h3>
  <br>
</div>

**Leaf** is a modern, high-performance ebook reader client tailored specifically for the **Biblophile** ecosystem. Built as a customized fork of Readest, it leverages Next.js, Tauri v2, and Supabase to deliver a smooth, cross-platform reading experience across macOS, Windows, Linux, Android, iOS, and the Web.

---

## 🌟 Ecosystem Features

* **Unified Authentication**: Log in using your unified Biblophile credentials (mirrored to Supabase Auth). Signups are centralized on the main Biblophile site to keep profiles consistent.
* **Reading Progress Sync**: Highlights, notes, bookmarks, and book files synchronize instantly to Supabase and propagate across all your reading devices.
* **MariaDB Stats Mirroring**: An active bridge service in the Express backend automatically pulls your reading stats from Supabase and populates MariaDB (`dbInsight` database) to update your global reading metrics and Buddy Reads progress.
* **Buddy Reads & Social**: Full client-side integration for joining buddy reads, posting annotations, and sharing comments, proxied directly to the Biblophile Express backend.
* **E-Ink Customizations**: Supports reaction emojis and custom styling tailored to match Biblophile's aesthetic.
* **KOReader & Calibre Integration**: Sync reading progress directly with KOReader e-ink devices or populate libraries from Calibre catalogs.

---

## 🏗️ Architecture & Integration

Leaf is designed to work in tandem with the **Biblophile Express Backend** and a **Supabase** instance.

```
[ Leaf Reader App (Client) ]
       │
       ├──► (Login/Sync) ────────► [ Supabase Instance ]
       │                             (Holds active user sessions,
       │                              file storage, and book sync tables)
       │
       └──► (Buddy Reads API) ───► [ Next.js Proxy ] ───► [ Biblophile Express Backend ]
                                                             (Handles social comments,
                                                              buddy reads, and MariaDB)
```

1. **Client-to-Supabase**: The Leaf client interacts directly with Supabase for the core reading loop (fetching EPUB/PDF files, bookmarks, highlights, and page-turn counts).
2. **Backend Mirroring**: When a user registers or edits their profile on your Biblophile website, the Express backend automatically creates or updates the corresponding account in Supabase via the Auth Admin API.
3. **Bridge Cron Job**: A periodic cron scheduler on your Express backend runs every 10 minutes to pull new reading stats from Supabase and write them to your MariaDB `dbInsight` database.

---

## 🚀 Getting Started

### 1. Database Schema Initialization
To initialize your Supabase instance, run the unified SQL migrations script in the **SQL Editor** on your Supabase Dashboard:

* **SQL Script Location**: [`docker/volumes/db/migrations/`](./docker/volumes/db/migrations/)
* Run all scripts (from `init/schema.sql` through `019_add_book_notes_reaction.sql`) in numerical order.

### 2. Express Backend Environment Variables
Configure the connection credentials in your Express backend's `.env` file:
```env
# Supabase Admin access (for account mirroring & stats bridge)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Leaf Reader Environment Variables
Configure your Next.js environments for the Leaf web app and desktop clients:
```env
# Next.js Public APIs
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_BIBLO_API_URL=https://api.biblophile.com/api/v0
```

### 4. Centralize Signups
To block un-mirrored signups, set `DISABLE_SIGNUP=true` in your Reader's `docker/.env` config. The login panel will automatically direct users to sign up on your main Biblophile site instead.

---

## 🛠️ Building & Development

### Web App Development
Run the Next.js development server:
```bash
cd apps/readest-app
pnpm install
pnpm dev
```

### Desktop App (Tauri)
To run the desktop application locally:
```bash
cd apps/readest-app
pnpm tauri dev
```

---

## ⚖️ License

Leaf is distributed under the terms of the **GNU Affero General Public License v3**. Check out the [LICENSE](LICENSE) file for complete details.
