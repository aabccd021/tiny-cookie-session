first_line=$(head -n 1 ./var/logs.txt)

if [ "$first_line" != "cookie-theft" ]; then
  echo "Cookie theft not detected"
  exit 1
fi

sed -i '1d' ./var/logs.txt
