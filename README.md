# Virall tests
Node 22+ only, koi npm install nahi.

    npm test                  # sab (96 tests)
    npm run test:unit         # sirf unit
    npm run test:integration  # sirf integration

Layout: src/ = aapka code (fixed writer.js ke saath), test/unit, test/integration, test/helpers (fake D1 = node:sqlite par asli schema.sql).
Apne repo me use karne ke liye: src/ ki jagah apni files rakho, test/ folder copy karo, schema.sql root me rakho.
