require 'httparty'

def random_string(length=20)
  random_letter = lambda { ( (rand(2) == 0 ? 97 : 65) + rand(26)).chr}
  length.times.collect { random_letter.call }.join
end

while true
  token = random_string
  response = HTTParty.get("http://deejay-staging.cloud.vitrue.com/test0", :follow_redirects => false)
  unless (response.code == 301)
    puts "\n#{Time.now}"
  else
    print "."
  end
  sleep 0.1
end
