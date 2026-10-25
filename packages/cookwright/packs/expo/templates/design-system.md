# Design system

This doc is the contract for the app's primitives: every component in `src/components/` (or `components/`) has one entry here, keyed by its name: a row in the table below, or a `## <Name>` or `### <Name>` heading of its own if you would rather write a section per primitive. The expo pack reads it two ways. At commit, the doc-sync rule `expo:design-doc` refuses a change to a component that does not stage this file. In doctor, the row `pack.expo.docs` counts the components with no entry here and names the first ones. Keep the first column, or the heading, exactly the component's name: its file name without the extension (and without a platform suffix: `Map` for `Map.web.tsx` and `Map.native.tsx`), or its directory's name for a `<Name>/index.tsx` (or `index.ios.tsx`, `index.android.tsx`).

| Primitive | File | Props | Notes |
| --- | --- | --- | --- |
