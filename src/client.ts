import { config } from "./config";
import { LibreLinkUpEndpoints, LibreLoginResponse, LibreResponse, LibreRedirectResponse, LibreUser } from "./types";
import { parseUser } from "./utils";

/**
 * A class for interacting with the Libre Link Up API.
 */
export class LibreLinkClient {
  private apiUrl = config.apiUrl;
  private accessToken: string | null = null;
  private patientId: string | null = null;

  // A cache for storing fetched data.
  private cache = new Map<string, any>();

  constructor(private options?: { email: string; password: string; }) {
    if (!options?.email && !config.credentials.email)
      throw new Error("Libre Link Up credentials are missing.");
  }

  /**
   * @description Get the user data. Only available after logging in.
   */
  public get me(): LibreUser {
    if(!this.cache.has("user"))
      throw new Error("User data is not available. Please log in first.");

    return this.cache.get("user");
  }

  /**
   * @description Log into the Libre Link Up API using the provided credentials.
   */
  public async login(): Promise<LibreLoginResponse> {
    const email = this.options?.email || config.credentials.email;
    const password = this.options?.password || config.credentials.password;
    
    try {
      type LoginResponse = LibreLoginResponse | LibreRedirectResponse;
      
      // Attempt to login to the Libre Link Up API.
      const response = await this._fetcher<LoginResponse>(LibreLinkUpEndpoints.Login, {
        method: "POST",
        body: JSON.stringify({
          email,
          password
        }),
      });

      // If the response contains a redirect, update the region and try again.
      if("redirect" in response.data) {
        this.verbose("Redirecting to region:", response.data.region);
        const regionUrl = await this.findRegion(response.data.region);
        // Update the API URL with the region url.
        this.apiUrl = regionUrl;
        
        return await this.login();
      }
  
      // If the status is 2, means the credentials are invalid.
      if(response.status === 2)
        throw new Error("Invalid credentials. Please ensure that the email and password work with the LibreLinkUp app.");
  
      if(!response.data) 
        throw new Error("No data returned from Libre Link Up API.");

      // Set the access token for future requests.
      this.accessToken = response.data.authTicket?.token;

      // Cache the user data for future use. Log in again to refresh the user data.
      this.cache.set("user", parseUser(response.data.user));

      this.verbose("Logged into Libre Link Up API.");

      return response as LibreLoginResponse;
    } catch(err) {
      console.error(err);
      throw new Error("Error logging into Libre Link Up API.");
    }
  }

  /**
   * @description Read the data from the Libre Link Up API.
   * @returns The data from the Libre Link Up API.
   * 
   * TODO: Extend this method to read the data from the Libre Link Up API and return in a more readable format.
   */
  public async read() {
    try {
      const patientId = await this.getPatientId();

      const response = await this._fetcher(`${LibreLinkUpEndpoints.Connections}/${patientId}/graph`);
      return response;
    } catch(err) {
      console.error(err);
      throw new Error("Error reading data from Libre Link Up API.");
    }
  }

  /**
   * @description Get the connections from the Libre Link Up API.
   */
  private async fetchConnections() {
    try {
      // Fetch the connections from the Libre Link Up API.
      return await this._fetcher(LibreLinkUpEndpoints.Connections);
    } catch(err) {
      console.error(err);
      throw new Error("Error fetching connections from Libre Link Up API.");
    }
  }

  /**
   * @description Get the patient ID from the connections.
   */
  private async getPatientId() {
    if(!this.patientId) {
      const connections = await this.fetchConnections();
  
      // If there are no connections, throw an error.
      if(!connections.data?.length)
        throw new Error("No connections found. Please ensure that you have a connection with the LibreLinkUp app.");
  
      const patientId = connections.data[0]?.patientId;

      this.verbose("Using patient ID:", patientId);
      return patientId;
    } else {
      this.verbose("Using cached connection ID.", this.patientId);
    }
  }

  /**
   * @description Find the region in the Libre Link Up API. This is used when the API returns a redirect.
   * @param region The region to find.
   * @returns The server URL for the region.
   */
  private async findRegion(region: string) {
    try {
      const response = await this._fetcher(LibreLinkUpEndpoints.Country);

      // Find the region in the response.
      const lslApi = response.data?.regionalMap[region]?.lslApi;

      if(!lslApi)
        throw new Error("Region not found in Libre Link Up API.");

      return lslApi;
    } catch(err) {
      console.error(err);
      throw new Error("Error finding region in Libre Link Up API.");
    }
  }

  /**
   * @description A generic fetcher for the Libre Link Up API.
   * @param endpoint
   * @param options
   */
  private async _fetcher<T = LibreResponse>(endpoint: string, options: RequestInit = { headers: {} }) {
    const headers = new Headers({
      ...options.headers,
      Authorization: this.accessToken ? `Bearer ${this.accessToken}` : "",
  
      // Libre Link Up API headers
      product: 'llu.android',
      version: config.lluVersion,
  
      'accept-encoding': 'gzip',
      'cache-control': 'no-cache',
      connection: 'Keep-Alive',
      'content-type': 'application/json',
    });
    
    const requestOptions: FetchRequestInit = Object.freeze({
      ...options,
      headers
    });

    try {
      const response = await fetch(
        `${this.apiUrl}/${endpoint}`,
        requestOptions
      );

      this.verbose(
        `[${endpoint}] (${response.status})`,
        `Response from Libre Link Up API`,
        JSON.stringify(response, null, 2)
      );

      if (!response.ok) {
        throw new Error(
          `Error fetching data from Libre Link Up API. Status: ${response.status}`
        );
      }

      const data = (await response.json()) as T;

      this.verbose(
        `[${endpoint}]`,
        `Data from Libre Link Up API`,
        JSON.stringify(data, null, 2)
      );

      return data;
    } catch (err) {
      console.error(err);
      throw new Error("Error fetching data from Libre Link Up API.");
    }
  }

  /**
   * @description A verbose logger.
   * @param args
   */
  private verbose(...args: any[]) {
    if (config.verbose) console.log(...args);
  }
}
