using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace JarvisWidgets
{
    public class ApiClient
    {
        private readonly HttpClient _httpClient;
        private readonly string _baseUrl;
        private string _accessToken;
        private string _refreshToken;

        public ApiClient(string baseUrl)
        {
            _baseUrl = baseUrl;
            _httpClient = new HttpClient();
            _httpClient.BaseAddress = new Uri(baseUrl);
            _httpClient.DefaultRequestHeaders.Accept.Add(
                new MediaTypeWithQualityHeaderValue("application/json"));
        }

        public void SetAccessToken(string token)
        {
            _accessToken = token;
            _httpClient.DefaultRequestHeaders.Authorization = 
                new AuthenticationHeaderValue("Bearer", token);
        }

        public async Task<bool> LoginAsync(string username, string password)
        {
            var loginRequest = new
            {
                username = username,
                password = password
            };

            var content = new StringContent(
                JsonConvert.SerializeObject(loginRequest),
                Encoding.UTF8,
                "application/json");

            var response = await _httpClient.PostAsync("/api/v1/auth/login", content);
            
            if (response.IsSuccessStatusCode)
            {
                var result = JsonConvert.DeserializeObject<LoginResponse>(
                    await response.Content.ReadAsStringAsync());
                
                _accessToken = result.AccessToken;
                _refreshToken = result.RefreshToken;
                SetAccessToken(_accessToken);
                
                return true;
            }

            return false;
        }

        public async Task<SystemHealth> GetSystemHealthAsync()
        {
            var response = await _httpClient.GetAsync("/api/v1/system/health");
            if (response.IsSuccessStatusCode)
            {
                return JsonConvert.DeserializeObject<SystemHealth>(
                    await response.Content.ReadAsStringAsync());
            }
            return null;
        }

        public async Task<WorkflowList> GetWorkflowsAsync()
        {
            var response = await _httpClient.GetAsync("/api/v1/workflows");
            if (response.IsSuccessStatusCode)
            {
                return JsonConvert.DeserializeObject<WorkflowList>(
                    await response.Content.ReadAsStringAsync());
            }
            return null;
        }

        public async Task<TicketList> GetTicketsAsync()
        {
            var response = await _httpClient.GetAsync("/api/v1/helpdesk/tickets");
            if (response.IsSuccessStatusCode)
            {
                return JsonConvert.DeserializeObject<TicketList>(
                    await response.Content.ReadAsStringAsync());
            }
            return null;
        }

        // Additional API methods...
    }

    public class LoginResponse
    {
        [JsonProperty("access_token")]
        public string AccessToken { get; set; }
        
        [JsonProperty("refresh_token")]
        public string RefreshToken { get; set; }
    }

    public class SystemHealth
    {
        [JsonProperty("status")]
        public string Status { get; set; }
        
        [JsonProperty("components")]
        public object Components { get; set; }
    }

    public class WorkflowList
    {
        [JsonProperty("workflows")]
        public object[] Workflows { get; set; }
    }

    public class TicketList
    {
        [JsonProperty("tickets")]
        public object[] Tickets { get; set; }
    }
}
