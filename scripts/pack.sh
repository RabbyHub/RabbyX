#!/usr/bin/env sh

script_dir="$( cd "$( dirname "$0"  )" && pwd  )"
project_dir=$(dirname "$script_dir")

RABBY_DESKTOP_REPO=$( cd "$project_dir/../RabbyDesktop" && pwd  )

export VERSION=0.60.1;
export RABBYX_GIT_HASH=$(git rev-parse --short HEAD);

TARGET_FILE=$project_dir/tmp/RabbyX-v${VERSION}-${RABBYX_GIT_HASH}.zip;

echo "[pack] RABBY_DESKTOP_REPO is $RABBY_DESKTOP_REPO";

# for windows, download zip.exe from http://stahlworks.com/dev/index.php?tool=zipunzip and add to your path

# rm -rf $RABBY_DESKTOP_REPO/assets/chrome_exts/rabby;
if [ -z $NO_BUILD ]; then
    yarn build:pro;
fi
echo "[pack] built finished";

cd $RABBY_DESKTOP_REPO/assets/chrome_exts/rabby;

rm -rf $project_dir/tmp/ && mkdir -p $project_dir/tmp/ && \
zip -r $TARGET_FILE ./*

cd $project_dir;
cp $TARGET_FILE $project_dir/tmp/RabbyX-latest.zip

# upload to storage
if [ -z $NO_UPLOAD ]; then
    aws s3 cp $project_dir/tmp/ s3://$RABBY_BUILD_BUCKET/rabby/_tools/ --recursive --exclude="*" --include "*.zip" --acl public-read
    aws cloudfront create-invalidation --distribution-id E1F7UQCCQWLXXZ --paths '/_tools/*.zip'
    echo "[pack] uploaded.";
fi

# cp to RabbyDesktop
rm -rf $RABBY_DESKTOP_REPO/release/rabbyx/ && mkdir -p $RABBY_DESKTOP_REPO/release/rabbyx/;
cp $TARGET_FILE $RABBY_DESKTOP_REPO/release/rabbyx/
cp $TARGET_FILE $RABBY_DESKTOP_REPO/release/rabbyx/RabbyX-latest.zip

echo "[pack] finished.";
