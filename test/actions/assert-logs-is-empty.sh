# assert ./var/logs.txt is empty

if [ -s ./var/logs.txt ]; then
  echo "Logs are not empty"
  exit 1
fi
