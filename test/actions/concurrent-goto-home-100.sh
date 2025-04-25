for i in {1..100}; do
  goto --url "http://localhost:8080/" --tab "$i" &
done
wait
