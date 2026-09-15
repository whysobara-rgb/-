# App icon source

`design/app-icon.svg` is the editable vector source for both platforms. Native PNGs are checked in and require no asset generation during mobile builds.

To reproduce the exports with Node.js:

```sh
npm install --prefix tool/branding --no-save --package-lock=false sharp@0.35.4
node tool/branding/export_icons.cjs
```

The exporter follows the existing iOS asset catalog sizes, creates all five Android densities, and flattens alpha for iOS app icons. Review the generated icons before committing changes. Do not substitute the storage-probe application for the main application in a delivery.
