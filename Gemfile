source "https://rubygems.org"

# Same toolchain GitHub Pages uses to build the site
gem "github-pages", group: :jekyll_plugins

group :jekyll_plugins do
  gem "jekyll-feed"
  gem "jekyll-seo-tag"
  gem "jekyll-sitemap"
end

# Ruby 3+ no longer bundles webrick (needed by `jekyll serve`)
gem "webrick", "~> 1.8"

# Windows/tzinfo
gem "tzinfo-data", platforms: %i[mingw mswin x64_mingw jruby]
gem "wdm", "~> 0.1" if Gem.win_platform?
