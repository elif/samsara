require 'httparty'

def random_string(length=20)
  random_letter = lambda { ( (rand(2) == 0 ? 97 : 65) + rand(26)).chr}
  length.times.collect { random_letter.call }.join
end

while true
  token = random_string
  response = HTTParty.get("http://localhost/a?test=#{token}")
  if (response.body != "test=#{token}")
    puts "\n[Error] expected #{token}, got #{response.body.split('=')[1]}"
    sleep 10
  else
    print "."
  end
end
