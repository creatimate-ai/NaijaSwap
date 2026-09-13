# NaijaSwap

NaijaSwap is a Nigerian phone-swap marketplace platform that helps users discover dealers and swap offers for mobile devices.

## Features

- Landing page and marketing content for a phone swap marketplace
- User flows for customer and dealer sign-up
- Dealer listings and requests management screens
- Firebase-backed project structure for hosting and backend services
- Responsive static web design for desktop and mobile users

## Project structure

- `index.html` – landing page
- `signup.html`, `login.html` – auth entry points
- `dashboard.html`, `dealer-dashboard.html` – dashboard screens
- `js/` – frontend logic and interactions
- `css/` – styling assets
- `functions/` – Firebase Cloud Functions
- `assets/` – static images and brand assets

## Local development

Open the project in a browser using a local static file server or serve it through Firebase:

```bash
firebase serve
```

Or use any lightweight static server for the project root.

## Deployment

This project is configured for Firebase hosting and related services, including:

- Firebase Hosting
- Firestore
- Firebase Storage
- Cloud Functions

### Render

If deploying this site as a Render Web Service, leave Render's **Root
Directory** blank (the repository root), use `npm install` as the build
command, and `npm start` as the start command. The root `package.json` and
`server.js` must be committed to the repository. The server serves the static
files and listens on Render's `PORT` environment variable.

Configure these Render environment variables for the API:

- `FIREBASE_SERVICE_ACCOUNT`: the complete service-account JSON downloaded
  from the `naijaswap1` Firebase project. The `project_id` in this JSON is
  authoritative for Firebase ID-token verification.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`
  for private document uploads.

Do not set `FIREBASE_PROJECT_ID` to a different Firebase project. A mismatch
between that value and the service account can cause valid `naijaswap1`
authentication tokens to be rejected with HTTP 401.

Alternatively, deploy it as a Render Static Site with the repository root as
the publish directory; a start command is not needed for a Static Site.

## License

This project is provided as-is for educational and development purposes.
